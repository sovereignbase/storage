import { CACHE_NAME, cacheObject, encodeObject } from '../.helpers/index.js'

export async function storeObject(
  id: string,
  host: string,
  cacheFor: number,
  cipherKeyBytes: Uint8Array,
  object: unknown,
  onObjectStored: (object: Uint8Array<ArrayBuffer>) => void
): Promise<void> {
  let url: URL

  try {
    url = new URL(host + id)

    if (
      url.protocol !== 'https:' ||
      url.hostname.length === 0 ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== `/${id}` ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return
    }
  } catch {
    return
  }

  const encoded = await encodeObject(object, cipherKeyBytes)

  const cache = await caches.open(CACHE_NAME)
  const request = new Request(url)

  void (await cacheObject(
    cache,
    request,
    new Response(encoded, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    }),
    cacheFor
  ))

  void onObjectStored(encoded)
}
