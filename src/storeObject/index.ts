import { CACHE_NAME, cacheObject, encodeObject } from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'
import { WriteQueue } from '../WriteQueue/index.js'
import type { URLString } from '../.types/index.js'

/**
 * Encrypts and caches an object, then adds a store operation to the persistent
 * write queue.
 *
 * The object is MessagePack-encoded, gzip-compressed, padded to a 1 KiB
 * boundary, and encrypted before it enters the Cache API. The returned promise
 * settles only after both the cache write and queue write complete. A queue
 * consumer can then read the opaque response from the cache and upload it to
 * `url`.
 *
 * @param url Absolute HTTP(S) URL that identifies the object locally and remotely.
 * @param object Any value supported by the MessagePack encoder.
 * @param cipherKey Cryptosuite cipher key used to encrypt the object.
 * @throws `StorageError` with code `MAX_OBJECT_SIZE_EXCEEDED` when the compressed
 * object exceeds 24 MiB. Encoding, encryption, Cache API, and IndexedDB failures
 * also reject the promise.
 */
export async function storeObject(
  url: URLString,
  object: unknown,
  cipherKey: CipherKey
): Promise<void> {
  const encoded = await encodeObject(object, cipherKey)

  const cache = await caches.open(CACHE_NAME)
  const request = new Request(url)

  void (await cacheObject(
    cache,
    request,
    new Response(encoded, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    })
  ))

  void (await WriteQueue.enqueue({
    kind: 'store',
    url,
  }))
}
