/**
 * Encrypted, cache-first object storage with a persistent write queue for
 * browser applications.
 *
 * @packageDocumentation
 */
export { loadObject } from './loadObject/index.js'
export { storeObject } from './storeObject/index.js'
export { deleteObject } from './deleteObject/index.js'
export { WriteQueue } from './WriteQueue/index.js'
export { StorageError, type StorageErrorCode } from './.errors/index.js'
export type { URLString, WriteOperation } from './.types/index.js'
