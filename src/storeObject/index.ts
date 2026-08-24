import {
  CACHE_NAME,
  cacheObject,
  encodeObject,
  parseObjectUrl,
} from '../.helpers/index.js'

/**
 * Encrypts an object and stores its encoded representation in the Cache API.
 *
 * This function provides local caching, not durable remote persistence. After
 * encoding, compression, encryption, and caching succeed, `onObjectStored` is
 * called with the opaque bytes that the application can upload to its storage
 * service. Persist the bytes unchanged at `host + id` with the
 * `application/octet-stream` media type so that {@link loadObject} can retrieve
 * them later. The public read endpoint must support cross-origin access for its
 * intended consumers, typically with `Access-Control-Allow-Origin: *`.
 *
 * The callback's return value is ignored and is not awaited. If the caller must
 * observe remote persistence, it should track and await that work separately.
 * Encoding, encryption, cache, and callback failures reject the returned
 * promise; failures in an unobserved promise created by the callback do not.
 *
 * @param id - Object identifier appended directly to `host`. It must produce a
 * URL whose path is exactly `/${id}` and which has no credentials, query, or
 * fragment.
 * @param host - HTTPS origin prefix ending in `/`, for example
 * `https://objects.example/`.
 * @param cacheFor - Cache-retention duration in milliseconds, recorded as a
 * deadline relative to the time the object is stored.
 * @param cipherKeyBytes - Raw AES-GCM key bytes used to encrypt the object. The
 * key must be valid for the Web Crypto API (16, 24, or 32 bytes).
 * @param object - Any value supported by the MessagePack encoder.
 * @param onObjectStored - Called once with the compressed, encrypted, and
 * MessagePack-wrapped bytes after they have been cached. The callback owns
 * remote persistence, and its return value is not awaited.
 * @returns A promise that settles after local caching and callback invocation.
 * It does not imply that callback-managed remote persistence has completed.
 *
 * @example Fire-and-forget local storage and hand the encrypted bytes to a persistence endpoint.
 * ```ts
 * void storeObject(
 *   'welcome',
 *   'https://objects.example/',
 *   15 * 60 * 1000,
 *   key,
 *   { title: 'Hello' },
 *   (bytes) => {
 *     void fetch('/api/objects/welcome', {
 *       method: 'PUT',
 *       headers: { 'content-type': 'application/octet-stream' },
 *       body: bytes,
 *     })
 *   }
 * )
 * ```
 */
export async function storeObject(
  id: string,
  host: string,
  cacheFor: number,
  cipherKeyBytes: Uint8Array,
  object: unknown,
  onObjectStored: (object: Uint8Array<ArrayBuffer>) => void
): Promise<void> {
  const url = parseObjectUrl(id, host)
  if (!url) return

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
