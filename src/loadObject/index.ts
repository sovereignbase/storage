import { CACHE_NAME, cacheObject, decodeObject } from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'

import type { URLString } from '../.types/index.js'

/**
 * Loads, decrypts, and decodes an object from the cache or its remote URL.
 *
 * The Cache API is checked first. On a miss, the URL is fetched without
 * credentials. Successful cache and network responses receive refreshed cache
 * metadata in the background. A non-successful HTTP response resolves to
 * `undefined`.
 *
 * @param url Absolute HTTP(S) URL used as both the cache key and network location.
 * @param cipherKey The same cryptosuite cipher key used to store the object.
 * @returns The decoded object, or `undefined` for a non-successful HTTP response.
 */
export async function loadObject(
  url: URLString,
  cipherKey: CipherKey
): Promise<unknown> {
  const cache = await caches.open(CACHE_NAME)

  const request = new Request(url)

  let response = await cache.match(request)

  if (!response) response = await fetch(request)
  if (!response.ok) return

  const responseToCache = response.clone()

  // Reads always refresh cache freshness without delaying callback hydration.
  void queueMicrotask(() => cacheObject(cache, request, responseToCache))

  return await decodeObject(
    new Uint8Array(await response.arrayBuffer()),
    cipherKey
  )
}
