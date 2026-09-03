import { getIDB } from '../.helpers/index.js'
import type { WriteOperation } from '../.types/index.js'

/** Persistent FIFO of remote store and delete operations. */
export class WriteQueue {
  /** Called after an operation has been committed to the queue. */
  public static onQueued: () => void

  /** Adds an operation to the end of the queue. */
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
      req.onerror = () => void reject(req.error)
    })
  }

  /**
   * Returns the oldest operation without removing it.
   *
   * Call `finalize` only after the corresponding remote write succeeds. An
   * operation remains at the head of the queue until finalized.
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
              req.onerror = () => void reject(req.error)
            })
          },
        })
      }

      req.onerror = () => void reject(req.error)
    })
  }

  /** Returns the number of pending operations. */
  static async size(): Promise<number> {
    const db = await getIDB()
    return new Promise((resolve, reject) => {
      const req = db
        .transaction('write-queue')
        .objectStore('write-queue')
        .count()
      req.onsuccess = () => void resolve(req.result)
      req.onerror = () => void reject(req.error)
    })
  }
}
