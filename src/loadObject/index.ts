import {
  CACHE_NAME,
  cacheObject,
  decodeObject,
  parseObjectUrl,
} from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'

/**
 * Loads and cryptosuite-decrypts an object from a cache-first public URL.
 *
 * The Cache API is checked before the network. On a cache miss, the object is
 * fetched from `host + id`; the hosting server therefore needs to make the
 * exact URL publicly readable and, for cross-origin consumers, return an
 * `Access-Control-Allow-Origin` header that permits them (typically `*`). A
 * successful response is written back with standard HTTP cache headers whose
 * freshness is refreshed to `cacheFor` milliseconds from the time of access.
 * Cache hits receive the same refresh, giving frequently used objects sliding
 * freshness.
 *
 * The callback is invoked after successful decryption and decoding. Its return
 * value is ignored. A DOM consumer can intentionally start a load without
 * awaiting it, finish constructing the surrounding UI, and hydrate the content
 * from the callback when it becomes available.
 *
 * Invalid object URLs and non-successful HTTP responses complete without
 * invoking `onObjectLoaded`. Cache, network, decompression, decryption, and
 * decoding failures reject the returned promise.
 *
 * @param id - Object identifier appended directly to `host`. It must produce a
 * URL whose path is exactly `/${id}` and which has no credentials, query, or
 * fragment.
 * @param host - HTTPS origin prefix ending in `/`, for example
 * `https://objects.example/`.
 * @param cacheFor - Sliding cache freshness in milliseconds. Each successful
 * use refreshes `Cache-Control`, `Date`, and `Expires`.
 * @param cipherKey - Cryptosuite `CipherKey` JWK originally used to encrypt the
 * object. A different key cannot decrypt the stored bytes.
 * @param onObjectLoaded - Called once with the decoded object after a successful
 * load. The callback's return value is not awaited.
 * @returns A promise that settles after the load and callback invocation have
 * been initiated. It does not adopt a promise returned by the callback.
 *
 * @example Hydrate an element without blocking construction of the rest of the DOM.
 * ```ts
 * import { loadObject } from '@sovereignbase/storage'
 * import type { CipherKey } from '@sovereignbase/cryptosuite'
 *
 * declare const cipherKey: CipherKey
 *
 * const article = document.createElement('article')
 * article.textContent = 'Loading…'
 * document.body.append(article)
 *
 * void loadObject(
 *   'welcome',
 *   'https://objects.example/',
 *   15 * 60 * 1000,
 *   cipherKey,
 *   (object) => {
 *     article.textContent = String(object)
 *   }
 * )
 * ```
 */
export async function loadObject(
  id: string,
  host: string,
  cacheFor: number,
  cipherKey: CipherKey,
  onObjectLoaded: (object: unknown) => void
): Promise<void> {
  const url = parseObjectUrl(id, host)
  if (!url) return

  const cache = await caches.open(CACHE_NAME)

  const request = new Request(url)

  let response = await cache.match(request)

  if (!response) response = await fetch(request)
  if (!response.ok) return

  // Network reads also always refresh cache freshness.
  const retained = await cacheObject(cache, request, response, cacheFor)

  void onObjectLoaded(
    await decodeObject(await retained.arrayBuffer(), cipherKey)
  )
}
