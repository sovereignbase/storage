/**
 * All structured error codes thrown by the Storage.
 */
export type StorageErrorCode = 'MAX_OBJECT_SIZE_EXCEEDED'

/**
 * Error type used by the Storage helpers to expose a stable error code.
 */
export class StorageError extends Error {
  /**
   * Machine-readable error code for programmatic handling.
   */
  readonly code: StorageErrorCode

  /**
   * Creates a new Storage error with a package-prefixed message.
   *
   * @param code Stable error code describing the failure category.
   * @param message Optional human-readable detail appended to the package prefix.
   */
  constructor(code: StorageErrorCode, message?: string) {
    const detail = message ?? code
    super(`{@sovereignbase/storage} ${detail}`)
    this.code = code
    this.name = 'StorageError'
  }
}
