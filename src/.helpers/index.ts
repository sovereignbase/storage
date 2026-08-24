/** Cache namespace shared by all objects managed by this package. @internal */
export const CACHE_NAME = '@sovereignbase/storage/objects'

/** Header carrying the absolute cache-retention deadline. @internal */
export const CACHE_FOR_HEADER = 'x-cache-for'
import { decode, encode } from '@msgpack/msgpack'

/** Stores a response with refreshed retention metadata. @internal */
export async function cacheObject(
  cache: Cache,
  request: Request,
  response: Response,
  cacheFor: number
): Promise<Response> {
  const body = await response.arrayBuffer()

  const headers = new Headers(response.headers)
  headers.set(CACHE_FOR_HEADER, String(Date.now() + cacheFor))

  const retained = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })

  await cache.put(request, retained.clone())

  return retained
}

/** Decrypts, decompresses, and decodes a stored object. @internal */
export async function decodeObject(
  bytes: ArrayBuffer,
  cipherKeyBytes: Uint8Array
): Promise<unknown> {
  const { iv, ciphertext } = decode(new Uint8Array(bytes)) as {
    iv: BufferSource
    ciphertext: BufferSource
  }

  const key = await crypto.subtle.importKey(
    'raw',
    cipherKeyBytes as BufferSource,
    'AES-GCM',
    false,
    ['decrypt']
  )

  const compressed = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext
  )

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))

  const decompressed = await new Response(stream).arrayBuffer()

  return decode(new Uint8Array(decompressed))
}

/** Encodes, compresses, and encrypts an object for storage. @internal */
export async function encodeObject(
  object: unknown,
  cipherKeyBytes: Uint8Array
): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = encode(object)

  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  const compressed = await new Response(stream).arrayBuffer()

  const key = await crypto.subtle.importKey(
    'raw',
    cipherKeyBytes as BufferSource,
    'AES-GCM',
    false,
    ['encrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    compressed
  )

  return encode({
    iv,
    ciphertext: new Uint8Array(ciphertext),
  })
}
