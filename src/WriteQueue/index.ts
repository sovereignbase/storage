import { getIDB } from '../.helpers/index.js'
import { StorageError } from '../.errors/index.js'
import type { WriteOperation } from '../.types/index.js'

/** Persistent FIFO of remote store and delete operations. */
export class WriteQueue {
  /** Called after an operation has been committed to the queue. */
  public static onQueued: () => void

  /**
   * Adds an operation to the end of the queue.
   *
   * @throws `StorageError` with code `INDEXEDDB_OPEN_FAILED` or
   * `WRITE_QUEUE_ENQUEUE_FAILED`; the original IndexedDB error is retained as
   * `cause`.
   */
  static async enqueue(operation: WriteOperation): Promise<void> {
    const db = await getIDB()

    return new Promise<void>((resolve, reject) => {
      const req = db
        .transaction('write-queue', 'readwrite')
        .objectStore('write-queue')
        .add(operation)

      req.onsuccess = () => {
        if (typeof this.onQueued === 'function') void this.onQueued()
        void resolve()
      }
      req.onerror = () =>
        void reject(
          new StorageError('WRITE_QUEUE_ENQUEUE_FAILED', undefined, {
            cause: req.error,
          })
        )
    })
  }

  /**
   * Returns the oldest operation without removing it.
   *
   * Call `finalize` only after the corresponding remote write succeeds. An
   * operation remains at the head of the queue until finalized.
   *
   * @throws `StorageError` with code `INDEXEDDB_OPEN_FAILED` or
   * `WRITE_QUEUE_DEQUEUE_FAILED`. The returned `finalize` function can reject
   * with `WRITE_QUEUE_FINALIZE_FAILED`. The original IndexedDB error is retained
   * as `cause`.
   */
  static async dequeue(): Promise<
    | {
        operation: WriteOperation
        finalize: () => Promise<void>
      }
    | undefined
  > {
    const db = await getIDB()

    return new Promise((resolve, reject) => {
      const req = db
        .transaction('write-queue')
        .objectStore('write-queue')
        .openCursor()

      req.onsuccess = () => {
        const cursor = req.result

        if (!cursor) {
          void resolve(undefined)
          return
        }

        const key = cursor.primaryKey

        void resolve({
          operation: cursor.value as WriteOperation,

          finalize: async () => {
            await new Promise<void>((resolve, reject) => {
              const req = db
                .transaction('write-queue', 'readwrite')
                .objectStore('write-queue')
                .delete(key)

              req.onsuccess = () => void resolve()
              req.onerror = () =>
                void reject(
                  new StorageError('WRITE_QUEUE_FINALIZE_FAILED', undefined, {
                    cause: req.error,
                  })
                )
            })
          },
        })
      }

      req.onerror = () =>
        void reject(
          new StorageError('WRITE_QUEUE_DEQUEUE_FAILED', undefined, {
            cause: req.error,
          })
        )
    })
  }

  /**
   * Returns the number of pending operations.
   *
   * @throws `StorageError` with code `INDEXEDDB_OPEN_FAILED` or
   * `WRITE_QUEUE_SIZE_FAILED`; the original IndexedDB error is retained as
   * `cause`.
   */
  static async size(): Promise<number> {
    const db = await getIDB()
    return new Promise((resolve, reject) => {
      const req = db
        .transaction('write-queue')
        .objectStore('write-queue')
        .count()
      req.onsuccess = () => void resolve(req.result)
      req.onerror = () =>
        void reject(
          new StorageError('WRITE_QUEUE_SIZE_FAILED', undefined, {
            cause: req.error,
          })
        )
    })
  }
}
