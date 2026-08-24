[![npm version](https://img.shields.io/npm/v/@sovereignbase/storage)](https://www.npmjs.com/package/@sovereignbase/storage)
[![JSR](https://jsr.io/badges/@sovereignbase/storage)](https://jsr.io/@sovereignbase/storage)
[![CI](https://github.com/sovereignbase/storage/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/sovereignbase/storage/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/sovereignbase/storage/branch/master/graph/badge.svg)](https://codecov.io/gh/sovereignbase/storage)
[![license](https://img.shields.io/npm/l/@sovereignbase/storage)](LICENSE)

# storage

Encrypted, cache-first object storage for browsers. Objects are cached locally
while the application owns persistence to a public cross-origin URL.

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

### Store

```js
import { storeObject } from '@sovereignbase/storage'

const id = 'profile'
const host = 'https://objects.example/'
const cacheFor = 15 * 60 * 1000
const cipherKeyBytes = crypto.getRandomValues(new Uint8Array(32))

void storeObject(
  id,
  host,
  cacheFor,
  cipherKeyBytes,
  { name: 'Ada' },
  (bytes) => {
    void fetch(`/api/objects/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
  }
)
```

The callback persists the bytes so they become publicly readable from
`host + id`.

### Load and hydrate

```js
import { loadObject } from '@sovereignbase/storage'

const article = document.createElement('article')
const output = document.createElement('output')
output.textContent = 'Loading…'

void loadObject(id, host, cacheFor, cipherKeyBytes, (object) => {
  output.textContent = object.name
})

article.append(output)
document.body.append(article)
```

## API

### `storeObject(...)`

MessagePack-encodes, gzip-compresses, AES-GCM-encrypts, and caches an object.
After caching, `onObjectStored` receives the opaque bytes for application-owned
server or cloud persistence. The callback return value is not awaited.

### `loadObject(...)`

Loads encrypted bytes from the cache first and `host + id` second, refreshes the
`cacheFor` deadline, decrypts and decodes the object, then calls
`onObjectLoaded`. It can be fired without `await` so the DOM can be constructed
before callback hydration.

## Behavior

- Browser-only ESM.
- Requires Cache API, Fetch, Web Crypto, `Blob`, `CompressionStream`, and
  `DecompressionStream`.
- Uses external `@msgpack/msgpack`; dependencies are not bundled.
- The object URL must be public HTTPS without credentials, query, or fragment.
- Cross-origin reads must allow the browser origin, typically with
  `Access-Control-Allow-Origin: *`.
- Cache hits take precedence over the network. Every successful use refreshes
  the internal `x-cache-for` deadline.
- The Cache API does not expire custom deadlines automatically; this package
  does not run an eviction scheduler.
- Invalid URLs and unsuccessful HTTP responses complete without a load
  callback. Other runtime failures reject the returned promise.

## Tests

- Unit and integration tests in Vitest with TypeScript.
- Browser E2E tests in Playwright with TypeScript.
- Browser matrix: Chromium, Firefox, WebKit.
- Coverage: 100% statements, branches, functions, and lines.

## License

Apache-2.0
