import { CACHE_NAME, cacheObject, decodeObject } from '../.helpers/index.js'

import type { CipherKey } from '@sovereignbase/cryptosuite'

import type { URLString } from '../.types/index.js'

export async function loadObject(
  url: URLString,
  cipherKey: CipherKey,
  onObjectLoaded: (object: unknown) => void
): Promise<void> {
  const cache = await caches.open(CACHE_NAME)

  const request = new Request(url)

  let response = await cache.match(request)

  if (!response) response = await fetch(request)
  if (!response.ok) return

  void onObjectLoaded(
    await decodeObject(new Uint8Array(await response.arrayBuffer()), cipherKey)
  )

  // Network reads also always refresh cache freshness.
  queueMicrotask(() => cacheObject(cache, request, response))
}
