import { Bytes } from '@sovereignbase/bytecodec'
import { Cryptographic, type CipherKey } from '@sovereignbase/cryptosuite'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { StorageError } from '../../src/.errors/index.js'
import {
  BROWSER_GC_HINT,
  cacheObject,
  decodeObject,
  encodeObject,
  getIDB,
  MAX_OBJECT_SIZE,
  padTo1KiB,
  unpadFrom1KiB,
} from '../../src/.helpers/index.js'
import { WriteQueue } from '../../src/WriteQueue/index.js'

let key: CipherKey
let wrongKey: CipherKey

beforeAll(async () => {
  ;[key, wrongKey] = await Promise.all([
    Cryptographic.cipherMessage.generateKey(),
    Cryptographic.cipherMessage.generateKey(),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('storage helpers', () => {
  it('retains a response with refreshed standard cache headers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let stored: Response | undefined
    const cache = {
      put: vi.fn(async (_request: Request, response: Response) => {
        stored = response
      }),
    } as unknown as Cache
    const request = new Request('https://objects.example/object')

    await cacheObject(
      cache,
      request,
      new Response('body', {
        status: 202,
        statusText: 'Accepted',
        headers: {
          age: '30',
          pragma: 'no-cache',
          'x-source': 'unit',
        },
      })
    )

    expect(cache.put).toHaveBeenCalledOnce()
    expect(stored).toBeInstanceOf(Response)
    expect(await stored?.text()).toBe('body')
    expect(stored?.status).toBe(202)
    expect(stored?.statusText).toBe('Accepted')
    expect(stored?.headers.get('x-source')).toBe('unit')
    expect(stored?.headers.get('cache-control')).toBe(
      `public, max-age=${BROWSER_GC_HINT}, must-revalidate`
    )
    expect(stored?.headers.get('date')).toBe(new Date(1_000).toUTCString())
    expect(stored?.headers.get('expires')).toBe(
      new Date(1_000 + BROWSER_GC_HINT * 1_000).toUTCString()
    )
    expect(stored?.headers.has('age')).toBe(false)
    expect(stored?.headers.has('pragma')).toBe(false)
  })

  it('round-trips supported objects through compression and encryption', async () => {
    const object = { title: 'encrypted', values: [1, true, null] }
    const encoded = await encodeObject(object, key)

    expect(encoded).toBeInstanceOf(Uint8Array)
    await expect(decodeObject(encoded, key)).resolves.toEqual(object)
    await expect(decodeObject(encoded, wrongKey)).rejects.toBeInstanceOf(Error)
  })

  it.each([
    [0, 1024],
    [1, 1024],
    [1019, 1024],
    [1020, 1024],
    [1021, 2048],
    [2044, 2048],
    [2045, 3072],
  ])(
    'pads %i bytes to %i bytes and unpads without copying',
    (length, paddedLength) => {
      const bytes = new Uint8Array(length)
      if (length > 0) bytes[length - 1] = 0xff

      const padded = padTo1KiB(bytes)
      const unpadded = unpadFrom1KiB(padded)

      expect(padded.byteLength).toBe(paddedLength)
      expect(unpadded.byteLength).toBe(length)
      expect(unpadded.buffer).toBe(padded.buffer)
      expect(unpadded.byteOffset).toBe(4)
      expect(unpadded).toEqual(bytes)
    }
  )

  it('stores the byte length in the four-byte padding prefix', () => {
    expect(padTo1KiB(new Uint8Array(1021)).slice(0, 4)).toEqual(
      new Uint8Array([0, 0, 3, 253])
    )
  })

  it.each([new Uint8Array(3), new Uint8Array([0, 0, 4, 0, ...Array(1020)])])(
    'rejects invalid padding with a structured storage error',
    (bytes) => {
      expect(() => unpadFrom1KiB(bytes)).toThrowError(
        expect.objectContaining({
          name: 'StorageError',
          code: 'INVALID_PADDING',
        })
      )
    }
  )

  it('rejects oversized compressed data without allocating it in the test', async () => {
    vi.spyOn(Bytes.gzip, 'encode').mockResolvedValue({
      byteLength: MAX_OBJECT_SIZE + 1,
    } as Uint8Array<ArrayBuffer>)

    await expect(encodeObject('too large', key)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'MAX_OBJECT_SIZE_EXCEEDED',
      message: '{@sovereignbase/storage} MAX_OBJECT_SIZE_EXCEEDED',
    })
  })

  it('supports a custom structured-error message', () => {
    expect(
      new StorageError('MAX_OBJECT_SIZE_EXCEEDED', 'custom')
    ).toMatchObject({
      name: 'StorageError',
      code: 'MAX_OBJECT_SIZE_EXCEEDED',
      message: '{@sovereignbase/storage} custom',
    })
  })

  it('propagates an IndexedDB open failure', async () => {
    const failure = new Error('open failed')
    const request = { error: failure } as unknown as IDBOpenDBRequest
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        queueMicrotask(() => request.onerror?.(new Event('error')))
        return request
      }),
    })

    await expect(getIDB()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'INDEXEDDB_OPEN_FAILED',
      cause: failure,
    })
    vi.unstubAllGlobals()
  })

  it('propagates failures from every write-queue request', async () => {
    const failure = new Error('request failed')
    const failingRequest = () => {
      const request = { error: failure } as unknown as IDBRequest
      queueMicrotask(() => request.onerror?.(new Event('error')))
      return request
    }
    const successfulRequest = (result: unknown) => {
      const request = { result } as unknown as IDBRequest
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
      return request
    }
    const operations = {
      add: vi.fn(failingRequest),
      openCursor: vi.fn(failingRequest),
      delete: vi.fn(failingRequest),
      count: vi.fn(failingRequest),
    }
    const database = {
      transaction: vi.fn(() => ({ objectStore: () => operations })),
    } as unknown as IDBDatabase
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => successfulRequest(database)),
    })

    await expect(
      WriteQueue.enqueue({ kind: 'store', url: 'https://objects.example/a' })
    ).rejects.toMatchObject({
      name: 'StorageError',
      code: 'WRITE_QUEUE_ENQUEUE_FAILED',
      cause: failure,
    })
    await expect(WriteQueue.dequeue()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'WRITE_QUEUE_DEQUEUE_FAILED',
      cause: failure,
    })
    await expect(WriteQueue.size()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'WRITE_QUEUE_SIZE_FAILED',
      cause: failure,
    })

    operations.openCursor.mockImplementationOnce(() =>
      successfulRequest({
        primaryKey: 1,
        value: { kind: 'delete', url: 'https://objects.example/a' },
      })
    )
    const queued = await WriteQueue.dequeue()
    await expect(queued?.finalize()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'WRITE_QUEUE_FINALIZE_FAILED',
      cause: failure,
    })
    vi.unstubAllGlobals()
  })
})
