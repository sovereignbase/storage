import { CACHE_NAME, cacheObject, decodeObject } from '../.helpers/index.js'

export async function loadObject(
  id: string,
  host: string,
  cacheFor: number,
  cipherKeyBytes: Uint8Array,
  onObjectLoaded: (object: unknown) => void
): Promise<void> {
  let url: URL

  try {
    url = new URL(host + id)
    url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === `/${id}` &&
      url.search === '' &&
      url.hash === ''
  } catch {
    return
  }

  const cache = await caches.open(CACHE_NAME)

  const request = new Request(url)

  let response = await cache.match(request)

  if (!response) response = await fetch(request)
  if (!response.ok) return

  // Network reads also always refresh retention.
  const retained = await cacheObject(cache, request, response, cacheFor)

  void onObjectLoaded(
    decodeObject(await retained.arrayBuffer(), cipherKeyBytes)
  )
}
