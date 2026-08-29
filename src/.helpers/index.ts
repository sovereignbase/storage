/** Cache namespace shared by all objects managed by this package. @internal */
export const CACHE_NAME = '@sovereignbase/storage/objects'
import { decode, encode } from '@msgpack/msgpack'
import {
  Cryptographic,
  type CipherKey,
  type CipherMessage,
} from '@sovereignbase/cryptosuite'

/** Constructs a canonical public HTTPS object URL. @internal */
export function parseObjectUrl(id: string, host: string): URL | undefined {
  try {
    const url = new URL(host + id)

    if (url.href !== `https://${url.host}/${id}`) return

    return url
  } catch {
    return
  }
}

/** Stores a response with refreshed standard HTTP cache metadata. @internal */
export async function cacheObject(
  cache: Cache,
  request: Request,
  response: Response,
  cacheFor: number
): Promise<Response> {
  const body = await response.arrayBuffer()

  const cachedAt = Date.now()
  const maxAge = Math.max(0, Math.floor(cacheFor / 1000))
  const headers = new Headers(response.headers)
  headers.set('cache-control', `public, max-age=${maxAge}, must-revalidate`)
  headers.set('date', new Date(cachedAt).toUTCString())
  headers.set('expires', new Date(cachedAt + maxAge * 1000).toUTCString())
  headers.delete('age')
  headers.delete('pragma')

  const retained = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })

  await cache.put(request, retained.clone())

  return retained
}

/** Decrypts a cryptosuite cipher message, decompresses it, and decodes its MessagePack object. @internal */
export async function decodeObject(
  bytes: ArrayBuffer,
  cipherKey: CipherKey
): Promise<unknown> {
  const cipherMessage = decode(new Uint8Array(bytes)) as CipherMessage

  const compressed = await Cryptographic.cipherMessage.decrypt(
    cipherKey,
    cipherMessage
  )

  const stream = new Blob([compressed as BufferSource])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))

  const decompressed = await new Response(stream).arrayBuffer()

  return decode(new Uint8Array(decompressed))
}

/** MessagePack-encodes an object, compresses it, and encrypts it through cryptosuite. @internal */
export async function encodeObject(
  object: unknown,
  cipherKey: CipherKey
): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = encode(object)

  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())

  const cipherMessage = await Cryptographic.cipherMessage.encrypt(
    cipherKey,
    compressed
  )

  return encode(cipherMessage)
}
