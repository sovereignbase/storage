import { Cryptographic, type CipherKey } from '@sovereignbase/cryptosuite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cacheObject,
  decodeObject,
  encodeObject,
  parseObjectUrl,
} from '../../src/.helpers/index.js'

let key: CipherKey
let wrongKey: CipherKey

beforeAll(async () => {
  const keys = await Promise.all([
    Cryptographic.cipherMessage.generateKey(),
    Cryptographic.cipherMessage.generateKey(),
  ])
  key = keys[0]
  wrongKey = keys[1]
})

describe('storage helpers', () => {
  it('accepts only canonical public HTTPS object URLs', () => {
    expect(parseObjectUrl('object', 'https://objects.example/')?.href).toBe(
      'https://objects.example/object'
    )
    expect(parseObjectUrl('object', 'http://objects.example/')).toBeUndefined()
    expect(parseObjectUrl('object', 'not a URL/')).toBeUndefined()
  })

  it('retains the response with refreshed standard cache headers', async () => {
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
        headers: {
          age: '30',
          pragma: 'no-cache',
          'x-source': 'unit',
        },
      }),
      60_000
    )

    expect(cache.put).toHaveBeenCalledOnce()
    expect(stored).toBeInstanceOf(Response)
    expect(await stored?.text()).toBe('body')
    expect(await retained.text()).toBe('body')
    expect(retained.status).toBe(202)
    expect(retained.statusText).toBe('Accepted')
    expect(retained.headers.get('x-source')).toBe('unit')
    expect(retained.headers.get('cache-control')).toBe(
      'public, max-age=60, must-revalidate'
    )
    expect(retained.headers.get('date')).toBe(new Date(1_000).toUTCString())
    expect(retained.headers.get('expires')).toBe(new Date(61_000).toUTCString())
    expect(retained.headers.has('age')).toBe(false)
    expect(retained.headers.has('pragma')).toBe(false)
  })

  it('round-trips supported objects through compression and encryption', async () => {
    const object = { title: 'encrypted', values: [1, true, null] }
    const encoded = await encodeObject(object, key)
    const bytes = new Uint8Array(encoded).buffer

    expect(encoded).toBeInstanceOf(Uint8Array)
    await expect(decodeObject(bytes, key)).resolves.toEqual(object)
    await expect(decodeObject(bytes, wrongKey)).rejects.toBeInstanceOf(Error)
  })
})
