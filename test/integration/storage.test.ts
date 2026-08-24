import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadObject, storeObject } from '../../src/index.js'

const CACHE_NAME = '@sovereignbase/storage/objects'
const HOST = 'https://objects.example/'
const ID = 'object'
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index)

class MemoryCache {
  readonly entries = new Map<string, Response>()
  readonly puts: Array<{ request: Request; response: Response }> = []

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone()
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone())
    this.puts.push({ request, response: response.clone() })
  }
}

let cache: MemoryCache
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
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
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('public storage API', () => {
  it('stores encrypted bytes and loads the decoded object from cache', async () => {
    const object = { title: 'Cached', values: [1, true, null] }
    let stored: Uint8Array<ArrayBuffer> | undefined

    await storeObject(ID, HOST, 60_000, KEY, object, (bytes) => {
      stored = bytes
    })

    expect(stored).toBeInstanceOf(Uint8Array)
    expect(cache.puts).toHaveLength(1)
    expect(cache.puts[0].request.url).toBe(`${HOST}${ID}`)
    expect(cache.puts[0].response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(cache.puts[0].response.headers.get('cache-control')).toBe(
      'public, max-age=60, must-revalidate'
    )

    cache.puts.length = 0
    let loaded: unknown
    await loadObject(ID, HOST, 60_000, KEY, (object) => {
      loaded = object
    })

    expect(loaded).toEqual(object)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.puts).toHaveLength(1)
    expect(cache.puts[0].response.headers.get('cache-control')).toBe(
      'public, max-age=60, must-revalidate'
    )
  })

  it('loads a cache miss from the network and retains response metadata', async () => {
    let encoded: Uint8Array<ArrayBuffer> | undefined
    await storeObject(ID, HOST, 60_000, KEY, 'network object', (bytes) => {
      encoded = bytes
    })

    cache = new MemoryCache()
    fetchMock.mockResolvedValue(
      new Response(encoded, {
        status: 206,
        statusText: 'Partial Content',
        headers: { 'x-source': 'network' },
      })
    )

    let loaded: unknown
    await loadObject(ID, HOST, 30_000, KEY, (object) => {
      loaded = object
    })

    expect(loaded).toBe('network object')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0].url).toBe(`${HOST}${ID}`)
    expect(cache.puts[0].response.status).toBe(206)
    expect(cache.puts[0].response.statusText).toBe('Partial Content')
    expect(cache.puts[0].response.headers.get('x-source')).toBe('network')
    expect(cache.puts[0].response.headers.get('cache-control')).toBe(
      'public, max-age=30, must-revalidate'
    )
  })

  it('does not cache or call back for a non-successful response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    const onLoaded = vi.fn()

    await loadObject(ID, HOST, 60_000, KEY, onLoaded)

    expect(onLoaded).not.toHaveBeenCalled()
    expect(cache.puts).toHaveLength(0)
  })

  it.each(['not a URL/', 'http://objects.example/'])(
    'ignores invalid host %s',
    async (host) => {
      const onStored = vi.fn()
      const onLoaded = vi.fn()

      await storeObject(ID, host, 60_000, KEY, 'value', onStored)
      await loadObject(ID, host, 60_000, KEY, onLoaded)

      expect(onStored).not.toHaveBeenCalled()
      expect(onLoaded).not.toHaveBeenCalled()
      expect(caches.open).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('does not await callback-owned work and propagates synchronous errors', async () => {
    const pending = new Promise<void>(() => undefined)

    await expect(
      storeObject(ID, HOST, 60_000, KEY, 'value', () => pending)
    ).resolves.toBeUndefined()
    await expect(
      loadObject(ID, HOST, 60_000, KEY, () => pending)
    ).resolves.toBeUndefined()

    const failure = new Error('callback failed')
    await expect(
      storeObject(ID, HOST, 60_000, KEY, 'value', () => {
        throw failure
      })
    ).rejects.toBe(failure)
    await expect(
      loadObject(ID, HOST, 60_000, KEY, () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})
