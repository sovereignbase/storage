/** Cache namespace shared by all objects managed by this package. @internal */
export const CACHE_NAME = '@sovereignbase/storage/cache' as const
export const MAX_OBJECT_SIZE = (24 * 1024 * 1024) as const
export const BROWSER_GC_HINT = (60 * 60 * 24 * 90) as const

import { decode, encode } from '@msgpack/msgpack'
import { Bytes } from '@sovereignbase/bytecodec'
import {
  Cryptographic,
  type CipherKey,
  type CipherMessage,
} from '@sovereignbase/cryptosuite'
import { StorageError } from '../.errors/index.js'

/** Stores a response with refreshed standard HTTP cache metadata. @internal */
export async function cacheObject(
  cache: Cache,
  request: Request,
  response: Response
): Promise<void> {
  const body = await response.arrayBuffer()

  const cachedAt = Date.now()
  const headers = new Headers(response.headers)
  void headers.set(
    'cache-control',
    `public, max-age=${BROWSER_GC_HINT}, must-revalidate`
  )
  void headers.set('date', new Date(cachedAt).toUTCString())
  void headers.set(
    'expires',
    new Date(cachedAt + BROWSER_GC_HINT * 1000).toUTCString()
  )
  void headers.delete('age')
  void headers.delete('pragma')

  void (await cache.put(
    request,
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }).clone()
  ))
}

/** Decrypts a cryptosuite cipher message, decompresses it, and decodes its MessagePack object. @internal */
export async function decodeObject(
  bytes: Uint8Array,
  cipherKey: CipherKey
): Promise<unknown> {
  const cipherMessage = decode(bytes) as CipherMessage

  const compressed = await Cryptographic.cipherMessage.decrypt(
    cipherKey,
    cipherMessage
  )

  const decompressed = await Bytes.gzip.decode(compressed)

  return decode(decompressed)
}

/** MessagePack-encodes an object, compresses it, and encrypts it through cryptosuite. @internal */
export async function encodeObject(
  object: unknown,
  cipherKey: CipherKey
): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = encode(object)

  const compressed = await Bytes.gzip.encode(encoded)

  if (compressed.byteLength > MAX_OBJECT_SIZE)
    throw new StorageError('MAX_OBJECT_SIZE_EXCEEDED')

  const cipherMessage = await Cryptographic.cipherMessage.encrypt(
    cipherKey,
    compressed
  )

  return encode(cipherMessage)
}

export function getIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('@sovereignbase/storage/indexedDB', 1)

    req.onupgradeneeded = () => {
      void req.result.createObjectStore('write-queue', { autoIncrement: true })
    }

    req.onsuccess = () => void resolve(req.result)
    req.onerror = () => void reject(req.error)
  })
}
