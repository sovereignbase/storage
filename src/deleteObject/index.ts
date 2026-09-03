import { CACHE_NAME } from '../.helpers/index.js'
import { WriteQueue } from '../WriteQueue/index.js'
import type { URLString } from '../.types/index.js'

/**
 * Deletes an object from the local cache and adds a delete operation to the
 * persistent write queue.
 *
 * @param url Absolute HTTP(S) URL that identifies the object locally and remotely.
 */
export async function deleteObject(url: URLString): Promise<void> {
  const cache = await caches.open(CACHE_NAME)
  const request = new Request(url)

  void (await cache.delete(request))

  void (await WriteQueue.enqueue({
    kind: 'delete',
    url,
  }))
}
