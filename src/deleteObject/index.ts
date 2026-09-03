import { CACHE_NAME } from '../.helpers/index.js'
import { WriteQueue } from '../WriteQueue/index.js'
import type { URLString } from '../.types/index.js'

export async function deleteObject(url: URLString): Promise<void> {
  const cache = await caches.open(CACHE_NAME)
  const request = new Request(url)

  void cache.delete(request)

  void WriteQueue.enqueue({
    kind: 'delete',
    url,
  })
}
