[![npm version](https://img.shields.io/npm/v/@sovereignbase/storage)](https://www.npmjs.com/package/@sovereignbase/storage)
[![JSR](https://jsr.io/badges/@sovereignbase/storage)](https://jsr.io/@sovereignbase/storage)
[![CI](https://github.com/sovereignbase/storage/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/sovereignbase/storage/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/sovereignbase/storage/branch/master/graph/badge.svg)](https://codecov.io/gh/sovereignbase/storage)
[![license](https://img.shields.io/npm/l/@sovereignbase/storage)](LICENSE)

# storage

Encrypted, cache-first object storage with a persistent write queue for browser
applications. Objects are available locally immediately; the application owns
the worker that synchronizes queued changes to their HTTP(S) URLs.

## Installation

```sh
npm install @sovereignbase/storage
# or
pnpm add @sovereignbase/storage
# or
yarn add @sovereignbase/storage
# or
bun add @sovereignbase/storage
# or
deno add jsr:@sovereignbase/storage
# or
vlt install jsr:@sovereignbase/storage
```

## Usage

### Configure remote synchronization

`storeObject` and `deleteObject` commit locally and append an operation to
`WriteQueue`. Register a callback that drains the queue and performs your remote
writes. Call `finalize()` only after the server accepts an operation, so a failed
write remains available for retry.

```js
import { WriteQueue } from '@sovereignbase/storage'

let syncing = false

async function syncWrites() {
  if (syncing) return
  syncing = true

  try {
    let queued = await WriteQueue.dequeue()

    while (queued) {
      const { operation, finalize } = queued

      if (operation.kind === 'store') {
        const cached = await caches.match(operation.url)
        if (!cached) throw new Error(`Missing cached object: ${operation.url}`)

        const response = await fetch(operation.url, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: await cached.arrayBuffer(),
        })
        if (!response.ok) throw new Error(`Store failed: ${response.status}`)
      } else {
        const response = await fetch(operation.url, { method: 'DELETE' })
        if (!response.ok) throw new Error(`Delete failed: ${response.status}`)
      }

      await finalize()
      queued = await WriteQueue.dequeue()
    }
  } finally {
    syncing = false
  }
}

WriteQueue.onQueued = () => void syncWrites()
void syncWrites() // resume operations left over from an earlier session
```

Queue operations contain URLs, not secret keys or plaintext values. A store
consumer obtains the already encrypted bytes from the Cache API.

### Store

```ts
import { storeObject } from '@sovereignbase/storage'
import { Cryptographic } from '@sovereignbase/cryptosuite'

const url = 'https://objects.example/profile'
const cipherKey = await Cryptographic.cipherMessage.generateKey()

await storeObject(url, { name: 'Ada' }, cipherKey)
```

The returned promise settles after the encrypted cache entry and its persistent
queue operation have both been written.

### Load and hydrate

```ts
import { loadObject } from '@sovereignbase/storage'

const objectPromise = loadObject(url, cipherKey)

// Build the UI while loading is already in progress.
const output = document.createElement('output')
output.textContent = 'Loading…'
document.body.append(output)

const object = (await objectPromise) as { name: string } | undefined
if (object) output.textContent = object.name
```

`loadObject` reads from the cache first and fetches `url` on a miss. Successful
reads refresh cache freshness metadata in the background. Start the load as early
as useful and await its promise when the value is needed. A non-successful HTTP
response resolves to `undefined`. Initial network, cache-read, and decoding errors
reject the promise; background cache-write failures do not.

Pass `true` as the third argument to avoid all network access. A cache miss then
resolves to `undefined`, even if a callback was provided:

```ts
const cachedObject = await loadObject(url, cipherKey, true)
```

### Merge a network replica in the background

Pass an optional fourth argument, `onNetworkResponse`, to fetch a network replica
after a cache hit. The promise returns the local object first. The background
fetch starts in a later task, so initialize local state directly after awaiting
the promise, before doing any further asynchronous work.

For example, an application using `@sovereignbase/sequencer` can hydrate a
`Projection` from a stored sequence and then merge the network sequence:

```ts
import { loadObject, storeObject } from '@sovereignbase/storage'
import { Projection } from '@sovereignbase/sequencer'

let list: Projection<string>
const objectPromise = loadObject(
  url,
  cipherKey,
  false,
  async (data: unknown) => {
    try {
      // Combine the replica with local edits, then persist the merged sequence.
      if (!list.merge(data)) throw new Error('Invalid network sequence')
      output.textContent = JSON.stringify(list.values())
      await storeObject(url, list.sequence(), cipherKey)
    } catch (error) {
      console.error('Could not merge or persist the network sequence', error)
    }
  }
)

// Build the UI while loading is already in progress.
const output = document.createElement('output')
output.textContent = 'Loading…'
document.body.append(output)

const data = await objectPromise
list = new Projection<string>(0, data)
output.textContent = JSON.stringify(list.values())
```

Use your application's actor ID in place of `0`. `@sovereignbase/sequencer` is
an application dependency, not a dependency of this storage package.

| Cache  | `cacheOnly` | Callback provided | Promise result                                   | Background network callback                      |
| ------ | ----------- | ----------------- | ------------------------------------------------ | ------------------------------------------------ |
| Hit    | `false`     | No                | Local object                                     | None; no network request                         |
| Hit    | `false`     | Yes               | Local object                                     | Once, with a successfully decoded network object |
| Miss   | `false`     | Either            | Network object, or `undefined` for an HTTP error | None; the promise delivers the network result    |
| Either | `true`      | Either            | Local object, or `undefined` on a miss           | None; no network request                         |

The callback receives decrypted, decoded data as `unknown` and may return a
promise. It runs for every successful background response, even if the data is
unchanged. There is one fetch per qualifying load, with no polling or automatic
retry. Invalid cached data rejects the initial load without starting a background
fetch.

The network replica does not automatically replace the cached object or enqueue
a write: it may lack local edits. The application owns validation, merging, UI
updates, and persistence. In the example, `storeObject` caches the merged sequence
and queues it for upload through the application's write synchronization worker.

Background HTTP, network, body-reading, and decoding failures skip the callback
and leave the local data usable. Callback exceptions and rejected callback
promises are also contained; catch errors inside the callback when the application
needs to report or retry them. These background failures do not reject the
already completed `loadObject` promise.

### Delete

```js
import { deleteObject } from '@sovereignbase/storage'

await deleteObject(url)
```

Deletion removes the local cache entry and persists a delete operation for the
sync worker.

### Key management

`storeObject` and `loadObject` accept a cryptosuite `CipherKey` JWK. Keep the key
secret and persist it separately from the encrypted object. Loading requires the
same key that was used for storage. Generate a random key with
`Cryptographic.cipherMessage.generateKey()` or derive one with
`Cryptographic.cipherMessage.deriveKey(sourceKeyMaterial, salt)`.

## Behavior

- Browser-only ESM.
- Requires the Cache API, IndexedDB, Fetch, Web Crypto, and `Blob`.
- Accepts an absolute `http://` or `https://` URL as each object's identity and
  remote location.
- Uses MessagePack, gzip compression, 1 KiB length-hiding padding, and
  cryptosuite encryption. Objects whose compressed representation exceeds 24
  MiB are rejected with error code `MAX_OBJECT_SIZE_EXCEEDED`; malformed
  decrypted padding is rejected with `INVALID_PADDING`.
- Cache hits take precedence over the network. Successful reads refresh
  `Cache-Control`, `Date`, and `Expires` with a 90-day freshness hint.
- An optional `loadObject` callback receives a decoded network replica after a
  cache hit. Merging and persisting it are the application's responsibility.
- Cache-only loads never make a network request.
- Remote responses need to allow the browser origin when used cross-origin.
- Write operations are stored in IndexedDB in FIFO order and remain queued until
  their `finalize()` function succeeds. Enqueuing another operation for the same
  URL replaces the older pending operation.
- IndexedDB failures reject with an operation-specific `StorageError`; the
  browser's original error is available through its `cause` property.
- Dependencies are not bundled.

## Tests

- Unit and integration tests run in Vitest with TypeScript.
- Browser E2E tests run in Playwright on Chromium, Firefox, WebKit, Pixel 7
  mobile Chromium, mobile Firefox emulation, and iPhone 15 mobile WebKit.
- Statement, branch, function, and line coverage are all held at 100%.

## License

Apache-2.0
