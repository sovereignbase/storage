import { CACHE_NAME, cacheObject, decodeObject } from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'

import type { URLString } from '../.types/index.js'

/**
 * Loads, decrypts, and decodes an object from the cache or its remote URL.
 *
 * The Cache API is checked first. On a miss, the URL is fetched.
 * Successful responses used for the initial load receive refreshed
 * cache metadata in the background. A non-successful HTTP response resolves to
 * `undefined`. Background cache-write failures do not reject the load.
 *
 * With `onNetworkResponse`, a successfully decoded cache hit also schedules one
 * background fetch, unless `cacheOnly` is true. It starts in a later task so an
 * immediate await of this promise can initialize local state before the callback
 * runs. A successful network response is decrypted and decoded for the callback;
 * it does not replace the cache. The caller owns merging and persisting changes.
 * Network, decoding, and callback failures in this background task are ignored;
 * callbacks should handle errors they need to report or retry.
 *
 * @param url Absolute HTTP(S) URL used as both the cache key and network location.
 * @param cipherKey The same cryptosuite cipher key used to store the object.
 * @param cacheOnly When true, return `undefined` on a cache miss without fetching.
 * @param onNetworkResponse Optional callback for the decoded network object after
 * a cache hit. Never called on a cache miss or a cache-only load. May be async.
 * @returns The decoded object, or `undefined` for a non-successful HTTP response.
 * @throws `StorageError` with code `INVALID_PADDING` when decrypted bytes do not
 * contain a valid length-prefixed 1 KiB padding envelope. Initial network,
 * cache-read, and decoding failures also reject the promise.
 */
export async function loadObject(
  url: URLString,
  cipherKey: CipherKey,
  cacheOnly: boolean = false,
  onNetworkResponse?: (data: unknown) => void | Promise<void>
): Promise<unknown> {
  const cache = await caches.open(CACHE_NAME)

  const request = new Request(url)

  let response = await cache.match(request)

  const cacheHit = !!response
  if (!response && cacheOnly) return
  if (!response) response = await fetch(request)
  if (!response.ok) return

  const responseToCache = response.clone()

  // Refresh metadata without making hydration depend on a cache write.
  void cacheObject(cache, request, responseToCache).catch(() => {})

  const object = await decodeObject(
    new Uint8Array(await response.arrayBuffer()),
    cipherKey
  )

  if (cacheHit && !cacheOnly && onNetworkResponse) {
    // Give the caller's immediate await time to initialize its local state.
    setTimeout(async () => {
      try {
        const networkResponse = await fetch(request)
        if (!networkResponse.ok) return

        await onNetworkResponse(
          await decodeObject(
            new Uint8Array(await networkResponse.arrayBuffer()),
            cipherKey
          )
        )
      } catch {
        // A background failure must not invalidate the locally hydrated object.
      }
    }, 0)
  }

  return object
}
