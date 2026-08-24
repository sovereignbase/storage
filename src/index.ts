/**
 * Encrypted, cache-first object storage for DOM and Worker environments.
 *
 * Objects are encoded with MessagePack, compressed with gzip, and encrypted
 * with AES-GCM before they leave the caller. The package keeps encrypted
 * representations in the platform Cache API; applications remain responsible
 * for persisting those bytes at public, CORS-enabled URLs.
 *
 * @packageDocumentation
 */
export { loadObject } from './loadObject/index.js'
export { storeObject } from './storeObject/index.js'
