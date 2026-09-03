import { CACHE_NAME, cacheObject, encodeObject } from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'
import { WriteQueue } from '../WriteQueue/index.js'
import { URLString } from '../.types/index.js'

export async function storeObject(
  url: URLString,
  object: unknown,
  cipherKey: CipherKey
): Promise<void> {
  const encoded = await encodeObject(object, cipherKey)

  const cache = await caches.open(CACHE_NAME)
  const request = new Request(url)

  void WriteQueue.enqueue({
    kind: 'store',
    url,
  })

  void (await cacheObject(
    cache,
    request,
    new Response(encoded, {
      headers: {
        'content-type': 'application/octet-stream',
      },
    })
  ))
}
