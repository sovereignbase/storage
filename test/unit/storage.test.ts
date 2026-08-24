import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_FOR_HEADER,
  cacheObject,
  decodeObject,
  encodeObject,
  parseObjectUrl,
} from '../../src/.helpers/index.js'

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index)

describe('storage helpers', () => {
  it('accepts only canonical public HTTPS object URLs', () => {
    expect(parseObjectUrl('object', 'https://objects.example/')?.href).toBe(
      'https://objects.example/object'
    )
    expect(parseObjectUrl('object', 'http://objects.example/')).toBeUndefined()
    expect(parseObjectUrl('object', 'not a URL/')).toBeUndefined()
  })

  it('retains the response body and metadata with a refreshed deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let stored: Response | undefined
    const cache = {
      put: vi.fn(async (_request: Request, response: Response) => {
        stored = response
      }),
    } as unknown as Cache
    const request = new Request('https://objects.example/object')

    const retained = await cacheObject(
      cache,
      request,
      new Response('body', {
        status: 202,
        statusText: 'Accepted',
        headers: { 'x-source': 'unit' },
      }),
      500
    )

    expect(cache.put).toHaveBeenCalledOnce()
    expect(stored).toBeInstanceOf(Response)
    expect(await stored?.text()).toBe('body')
    expect(await retained.text()).toBe('body')
    expect(retained.status).toBe(202)
    expect(retained.statusText).toBe('Accepted')
    expect(retained.headers.get('x-source')).toBe('unit')
    expect(retained.headers.get(CACHE_FOR_HEADER)).toBe('1500')
  })

  it('round-trips supported objects through compression and encryption', async () => {
    const object = { title: 'encrypted', values: [1, true, null] }
    const encoded = await encodeObject(object, KEY)
    const bytes = new Uint8Array(encoded).buffer

    expect(encoded).toBeInstanceOf(Uint8Array)
    await expect(decodeObject(bytes, KEY)).resolves.toEqual(object)
    await expect(
      decodeObject(bytes, new Uint8Array(32))
    ).rejects.toBeInstanceOf(Error)
  })
})
