import { getIDB } from '../.helpers/index.js'
import type { WriteOperation } from '../.types/index.js'

export class WriteQueue {
  public static onQueued: () => void

  static async enqueue(operation: WriteOperation): Promise<void> {
    const db = await getIDB()

    void new Promise<void>((resolve, reject) => {
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

              req.onsuccess = () => resolve()
              req.onerror = () => reject(req.error)
            })
          },
        })
      }

      req.onerror = () => reject(req.error)
    })
  }

  static async size(): Promise<number> {
    const db = await getIDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction('operations').objectStore('operations').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
}
