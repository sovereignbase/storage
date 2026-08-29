/**
 * Encrypted, cache-first object storage for browser DOM environments.
 *
 * Objects are encoded with MessagePack, compressed with gzip, and encrypted
 * through `@sovereignbase/cryptosuite` before they leave the caller. Encryption
 * uses the algorithm declared by the supplied cryptosuite `CipherKey`; newly
 * generated keys use AES-GCM-256. The package keeps encrypted representations
 * in the platform Cache API, while applications remain responsible for
 * persisting those bytes at public, CORS-enabled URLs.
 *
 * @packageDocumentation
 */
export { loadObject } from './loadObject/index.js'
export { storeObject } from './storeObject/index.js'
