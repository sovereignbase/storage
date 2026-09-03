import { Cryptographic, type CipherKey } from '@sovereignbase/cryptosuite'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteObject,
  loadObject,
  storeObject,
  WriteQueue,
} from '../../src/index.js'

const CACHE_NAME = '@sovereignbase/storage/cache'
const URL = 'https://objects.example/object' as const
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

    const onLoaded = vi.fn()
    await loadObject(URL, key, onLoaded)

    expect(onLoaded).toHaveBeenCalledWith(object)
    expect(fetchMock).not.toHaveBeenCalled()
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

    const onLoaded = vi.fn()
    await loadObject(URL, key, onLoaded)

    expect(onLoaded).toHaveBeenCalledWith('network object')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].url).toBe(URL)
    await vi.waitFor(() => expect(cache.puts).toHaveLength(1))
    expect(cache.puts[0].response.status).toBe(206)
    expect(cache.puts[0].response.statusText).toBe('Partial Content')
    expect(cache.puts[0].response.headers.get('x-source')).toBe('network')
  })

  it('does not cache or call back for a non-successful response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    const onLoaded = vi.fn()

    await loadObject(URL, key, onLoaded)

    expect(onLoaded).not.toHaveBeenCalled()
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
})
