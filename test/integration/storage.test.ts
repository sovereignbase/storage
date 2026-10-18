import { Cryptographic, type CipherKey } from '@sovereignbase/cryptosuite'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeObject } from '../../src/.helpers/index.js'
import {
  deleteObject,
  loadObject,
  storeObject,
  WriteQueue,
} from '../../src/index.js'

const CACHE_NAME = '@sovereignbase/storage/cache'
const URL = 'https://objects.example/object' as const
const OTHER_URL = 'https://objects.example/other' as const
let key: CipherKey

class MemoryCache {
  readonly entries = new Map<string, Response>()
  readonly puts: Array<{ request: Request; response: Response }> = []
  readonly deletes: Request[] = []

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone()
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone())
    this.puts.push({ request, response: response.clone() })
  }

  async delete(request: Request): Promise<boolean> {
    this.deletes.push(request)
    return this.entries.delete(request.url)
  }
}

let cache: MemoryCache
let fetchMock: ReturnType<typeof vi.fn>

async function networkResponse(
  object: unknown,
  cipherKey: CipherKey = key
): Promise<Response> {
  return new Response(await encodeObject(object, cipherKey))
}

// Observe completion of the next background task without changing its timing.
function backgroundCompletion(): Promise<void> {
  const completion = Promise.withResolvers<void>()
  const schedule = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback, delay) =>
    schedule(() => {
      Promise.resolve(callback()).then(completion.resolve, completion.reject)
    }, delay)
  )
  return completion.promise
}

async function clearWriteQueue(): Promise<void> {
  let queued = await WriteQueue.dequeue()
  while (queued) {
    await queued.finalize()
    queued = await WriteQueue.dequeue()
  }
}

beforeEach(async () => {
  await clearWriteQueue()
  key = await Cryptographic.cipherMessage.generateKey()
  cache = new MemoryCache()
  fetchMock = vi.fn()
  vi.stubGlobal('caches', {
    open: vi.fn(async (name: string) => {
      expect(name).toBe(CACHE_NAME)
      return cache
    }),
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Date, 'now').mockReturnValue(1_000)
  WriteQueue.onQueued = undefined as unknown as () => void
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('public storage API', () => {
  it('stores encrypted bytes in the cache and queues the write', async () => {
    const onQueued = vi.fn()
    WriteQueue.onQueued = onQueued

    await storeObject(URL, { title: 'Cached', values: [1, true, null] }, key)

    expect(onQueued).toHaveBeenCalledOnce()
    expect(cache.puts).toHaveLength(1)
    expect(cache.puts[0].request.url).toBe(URL)
    expect(cache.puts[0].response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(cache.puts[0].response.headers.get('cache-control')).toBe(
      'public, max-age=7776000, must-revalidate'
    )

    expect(await WriteQueue.size()).toBe(1)
    const queued = await WriteQueue.dequeue()
    expect(queued?.operation).toEqual({ kind: 'store', url: URL })
    await queued?.finalize()
    expect(await WriteQueue.size()).toBe(0)
  })

  it('loads and refreshes an object already in the cache', async () => {
    const object = { title: 'Cached' }
    await storeObject(URL, object, key)
    cache.puts.length = 0

    const loaded = await loadObject(URL, key, true)

    expect(loaded).toEqual(object)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(cache.puts).toHaveLength(1))
  })

  it('keeps cache-first loads without a callback offline', async () => {
    await storeObject(URL, 'local', key)

    expect(await loadObject(URL, key)).toBe('local')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hydrates before delivering even an immediately available network object', async () => {
    const local = { items: ['local edit'] }
    const remote = { items: ['remote edit'] }
    await storeObject(URL, local, key)
    await clearWriteQueue()
    cache.puts.length = 0
    fetchMock.mockResolvedValue(await networkResponse(remote))
    let hydrated: unknown
    const onNetworkResponse = vi.fn((data: unknown) => {
      expect(hydrated).toEqual(local)
      expect(data).toEqual(remote)
    })
    const completed = backgroundCompletion()

    hydrated = await loadObject(URL, key, false, onNetworkResponse)

    expect(hydrated).toEqual(local)
    expect(onNetworkResponse).not.toHaveBeenCalled()
    await completed
    expect(onNetworkResponse).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].url).toBe(URL)
    expect(await loadObject(URL, key, true)).toEqual(local)
    expect(await WriteQueue.size()).toBe(0)
  })

  it('returns local data while the network is pending and preserves newer local writes', async () => {
    await storeObject(URL, { items: ['local edit'] }, key)
    const pending = Promise.withResolvers<Response>()
    fetchMock.mockReturnValue(pending.promise)
    const onNetworkResponse = vi.fn()
    const completed = backgroundCompletion()

    expect(await loadObject(URL, key, false, onNetworkResponse)).toEqual({
      items: ['local edit'],
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(onNetworkResponse).not.toHaveBeenCalled()

    await storeObject(URL, { items: ['newer local edit'] }, key)
    pending.resolve(await networkResponse({ items: ['remote edit'] }))
    await completed

    expect(onNetworkResponse).toHaveBeenCalledExactlyOnceWith({
      items: ['remote edit'],
    })
    expect(await loadObject(URL, key, true)).toEqual({
      items: ['newer local edit'],
    })
    expect(await WriteQueue.size()).toBe(1)
  })

  it('allows the callback to merge and persist the resulting local state', async () => {
    await storeObject(URL, ['local edit'], key)
    fetchMock.mockResolvedValue(await networkResponse(['remote edit']))
    let items: string[]
    const completed = backgroundCompletion()

    items = (await loadObject(URL, key, false, async (data) => {
      items.push(...(data as string[]))
      await storeObject(URL, items, key)
    })) as string[]
    await completed

    expect(await loadObject(URL, key, true)).toEqual([
      'local edit',
      'remote edit',
    ])
    expect(await WriteQueue.size()).toBe(1)
  })

  it.each([true, false])(
    'never fetches or calls the callback for cache-only loads (hit: %s)',
    async (hit) => {
      if (hit) await storeObject(URL, 'local', key)
      const onNetworkResponse = vi.fn()

      expect(await loadObject(URL, key, true, onNetworkResponse)).toBe(
        hit ? 'local' : undefined
      )
      expect(fetchMock).not.toHaveBeenCalled()
      expect(onNetworkResponse).not.toHaveBeenCalled()
    }
  )

  it('returns a cache miss through the promise without also calling the callback', async () => {
    fetchMock.mockResolvedValue(await networkResponse('remote'))
    const onNetworkResponse = vi.fn()

    expect(await loadObject(URL, key, false, onNetworkResponse)).toBe('remote')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onNetworkResponse).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(cache.puts).toHaveLength(1))
    expect(await loadObject(URL, key, true)).toBe('remote')
  })

  it.each(['http', 'offline', 'invalid body', 'wrong key', 'unreadable body'])(
    'keeps local data when the background response fails: %s',
    async (failure) => {
      await storeObject(URL, 'local', key)
      if (failure === 'offline') {
        fetchMock.mockRejectedValue(new TypeError('Network unavailable'))
      } else if (failure === 'http') {
        fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
      } else if (failure === 'invalid body') {
        fetchMock.mockResolvedValue(new Response('not an encrypted object'))
      } else if (failure === 'wrong key') {
        fetchMock.mockResolvedValue(
          await networkResponse(
            'remote',
            await Cryptographic.cipherMessage.generateKey()
          )
        )
      } else {
        const response = await networkResponse('remote')
        vi.spyOn(response, 'arrayBuffer').mockRejectedValue(
          new Error('Read failed')
        )
        fetchMock.mockResolvedValue(response)
      }
      const onNetworkResponse = vi.fn()
      const completed = backgroundCompletion()

      expect(await loadObject(URL, key, false, onNetworkResponse)).toBe('local')
      await completed

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(onNetworkResponse).not.toHaveBeenCalled()
      expect(await loadObject(URL, key, true)).toBe('local')
    }
  )

  it.each([false, true])(
    'contains callback failures without changing local data (async: %s)',
    async (asyncCallback) => {
      await storeObject(URL, 'local', key)
      fetchMock.mockResolvedValue(await networkResponse('remote'))
      const failure = new Error('Merge failed')
      const onNetworkResponse = vi.fn(
        asyncCallback
          ? async () => {
              throw failure
            }
          : () => {
              throw failure
            }
      )
      const completed = backgroundCompletion()

      expect(await loadObject(URL, key, false, onNetworkResponse)).toBe('local')
      await completed

      expect(onNetworkResponse).toHaveBeenCalledExactlyOnceWith('remote')
      expect(await loadObject(URL, key, true)).toBe('local')
    }
  )

  it('hydrates and fetches even when the background cache metadata write fails', async () => {
    await storeObject(URL, 'local', key)
    vi.spyOn(cache, 'put').mockRejectedValue(new Error('Cache quota exceeded'))
    fetchMock.mockResolvedValue(await networkResponse('remote'))
    const onNetworkResponse = vi.fn()
    const completed = backgroundCompletion()

    expect(await loadObject(URL, key, false, onNetworkResponse)).toBe('local')
    await completed

    expect(onNetworkResponse).toHaveBeenCalledExactlyOnceWith('remote')
  })

  it('rejects a cache-miss network failure through the returned promise', async () => {
    const failure = new TypeError('Network unavailable')
    fetchMock.mockRejectedValue(failure)
    const onNetworkResponse = vi.fn()

    await expect(loadObject(URL, key, false, onNetworkResponse)).rejects.toBe(
      failure
    )
    expect(onNetworkResponse).not.toHaveBeenCalled()
  })

  it('rejects invalid cached data without scheduling a network callback', async () => {
    cache.entries.set(URL, new Response('invalid encrypted object'))
    const onNetworkResponse = vi.fn()

    await expect(
      loadObject(URL, key, false, onNetworkResponse)
    ).rejects.toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onNetworkResponse).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(cache.puts).toHaveLength(1))
  })

  it('loads a cache miss from the network and retains response metadata', async () => {
    await storeObject(URL, 'network object', key)
    const encoded = await cache.entries.get(URL)?.arrayBuffer()
    cache = new MemoryCache()
    fetchMock.mockResolvedValue(
      new Response(encoded, {
        status: 206,
        statusText: 'Partial Content',
        headers: { 'x-source': 'network' },
      })
    )

    const loaded = await loadObject(URL, key)

    expect(loaded).toBe('network object')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].url).toBe(URL)
    await vi.waitFor(() => expect(cache.puts).toHaveLength(1))
    expect(cache.puts[0].response.status).toBe(206)
    expect(cache.puts[0].response.statusText).toBe('Partial Content')
    expect(cache.puts[0].response.headers.get('x-source')).toBe('network')
  })

  it('does not cache and returns undefined for a non-successful response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    const loaded = await loadObject(URL, key)

    expect(loaded).toBeUndefined()
    expect(cache.puts).toHaveLength(0)
  })

  it('returns undefined without fetching on a cache-only miss', async () => {
    const loaded = await loadObject(URL, key, true)

    expect(loaded).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.puts).toHaveLength(0)
  })

  it('deletes the cached object and queues the deletion', async () => {
    await storeObject(URL, 'value', key)
    await clearWriteQueue()

    await deleteObject(URL)

    expect(cache.deletes[0].url).toBe(URL)
    expect(cache.entries.has(URL)).toBe(false)
    expect((await WriteQueue.dequeue())?.operation).toEqual({
      kind: 'delete',
      url: URL,
    })
  })

  it('keeps only the latest queued operation for each URL', async () => {
    await WriteQueue.enqueue({ kind: 'store', url: URL })
    await WriteQueue.enqueue({ kind: 'store', url: OTHER_URL })
    await WriteQueue.enqueue({ kind: 'delete', url: URL })

    expect(await WriteQueue.size()).toBe(2)

    const first = await WriteQueue.dequeue()
    expect(first?.operation).toEqual({ kind: 'store', url: OTHER_URL })
    await first?.finalize()

    const second = await WriteQueue.dequeue()
    expect(second?.operation).toEqual({ kind: 'delete', url: URL })
  })
})
