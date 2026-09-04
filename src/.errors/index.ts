/**
 * All structured error codes thrown by the Storage.
 */
export type StorageErrorCode =
  | 'INDEXEDDB_OPEN_FAILED'
  | 'INVALID_PADDING'
  | 'MAX_OBJECT_SIZE_EXCEEDED'
  | 'WRITE_QUEUE_DEQUEUE_FAILED'
  | 'WRITE_QUEUE_ENQUEUE_FAILED'
  | 'WRITE_QUEUE_FINALIZE_FAILED'
  | 'WRITE_QUEUE_SIZE_FAILED'

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
   * @param options Standard error options; use `cause` to retain an underlying error.
   */
  constructor(
    code: StorageErrorCode,
    message?: string,
    options?: ErrorOptions
  ) {
    const detail = message ?? code
    super(`{@sovereignbase/storage} ${detail}`, options)
    this.code = code
    this.name = 'StorageError'
  }
}
