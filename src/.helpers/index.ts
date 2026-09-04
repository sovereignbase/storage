/** Cache namespace shared by all objects managed by this package. @internal */
export const CACHE_NAME = '@sovereignbase/storage/cache' as const
export const MAX_OBJECT_SIZE = 24 * 1024 * 1024
export const BROWSER_GC_HINT = 60 * 60 * 24 * 90
const PADDING_BLOCK_SIZE = 1024
const LENGTH_PREFIX_SIZE = 4

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

/** Prefixes the byte length and pads to a 1 KiB boundary. @internal */
export function padTo1KiB(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const byteLength = bytes.byteLength
  const paddedLength =
    Math.ceil((LENGTH_PREFIX_SIZE + byteLength) / PADDING_BLOCK_SIZE) *
    PADDING_BLOCK_SIZE
  const padded = new Uint8Array(paddedLength)

  padded[0] = byteLength >>> 24
  padded[1] = byteLength >>> 16
  padded[2] = byteLength >>> 8
  padded[3] = byteLength
  padded.set(bytes, LENGTH_PREFIX_SIZE)

  return padded
}

/** Returns a view of the length-prefixed bytes without allocating a new buffer. @internal */
export function unpadFrom1KiB(bytes: Uint8Array): Uint8Array {
  const byteLength =
    bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3]
  const paddedLength =
    Math.ceil((LENGTH_PREFIX_SIZE + byteLength) / PADDING_BLOCK_SIZE) *
    PADDING_BLOCK_SIZE

  if (bytes.byteLength !== paddedLength)
    throw new StorageError('INVALID_PADDING')

  return bytes.subarray(LENGTH_PREFIX_SIZE, LENGTH_PREFIX_SIZE + byteLength)
}

/** Decrypts a cryptosuite cipher message, decompresses it, and decodes its MessagePack object. @internal */
export async function decodeObject(
  bytes: Uint8Array,
  cipherKey: CipherKey
): Promise<unknown> {
  const cipherMessage = decode(bytes) as CipherMessage

  const compressed = unpadFrom1KiB(
    await Cryptographic.cipherMessage.decrypt(cipherKey, cipherMessage)
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

  const padded = padTo1KiB(compressed)

  const cipherMessage = await Cryptographic.cipherMessage.encrypt(
    cipherKey,
    padded
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
    req.onerror = () =>
      void reject(
        new StorageError('INDEXEDDB_OPEN_FAILED', undefined, {
          cause: req.error,
        })
      )
  })
}
