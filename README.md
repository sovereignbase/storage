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
import { Cryptographic } from '@sovereignbase/cryptosuite'

const id = 'profile'
const host = 'https://objects.example/'
const cacheFor = 15 * 60 * 1000
const cipherKey = await Cryptographic.cipherMessage.generateKey()

void storeObject(id, host, cacheFor, cipherKey, { name: 'Ada' }, (bytes) => {
  void fetch(`/api/objects/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  })
})
```

The callback persists the bytes so they become publicly readable from
`host + id`.

### Load and hydrate

```js
import { loadObject } from '@sovereignbase/storage'

const article = document.createElement('article')
const output = document.createElement('output')
output.textContent = 'Loading…'

void loadObject(id, host, cacheFor, cipherKey, (object) => {
  output.textContent = object.name
})

article.append(output)
document.body.append(article)
```

### Key management

`storeObject` and `loadObject` accept a cryptosuite `CipherKey` JWK. Keep the
key secret and persist it separately from the encrypted object: loading requires
the same key that was used for storage. Generate a random key with
`Cryptographic.cipherMessage.generateKey()` or deterministically derive one with
`Cryptographic.cipherMessage.deriveKey(sourceKeyMaterial, salt)`.

Raw `Uint8Array` AES keys accepted by earlier storage versions are no longer a
valid argument. Migrate key material to a cryptosuite `CipherKey` and re-encrypt
stored objects before relying on the new format.

## API

### `storeObject(...)`

MessagePack-encodes and gzip-compresses an object, encrypts it with
`@sovereignbase/cryptosuite`, and caches the result. Pass a cryptosuite
`CipherKey`, such as the JWK returned by
`Cryptographic.cipherMessage.generateKey()`. After caching, `onObjectStored`
receives the opaque bytes for application-owned server or cloud persistence.
The callback return value is not awaited.

### `loadObject(...)`

Loads encrypted bytes from the cache first and `host + id` second, refreshes the
standard cache headers for `cacheFor`, decrypts and decodes the object, then calls
`onObjectLoaded`. It can be fired without `await` so the DOM can be constructed
before callback hydration.

## Behavior

- Browser-only ESM.
- Requires Cache API, Fetch, Web Crypto, `Blob`, `CompressionStream`, and
  `DecompressionStream`.
- Uses external `@msgpack/msgpack` and `@sovereignbase/cryptosuite`;
  dependencies are not bundled.
- The object URL must be public HTTPS without credentials, query, or fragment.
- Cross-origin reads must allow the browser origin, typically with
  `Access-Control-Allow-Origin: *`.
- Cache hits take precedence over the network. Every successful use refreshes
  `Cache-Control`, `Date`, and `Expires`.
- Cached responses are `public`, use `max-age` and `must-revalidate`, and remain
  in the browser's default best-effort storage pool.
- Invalid URLs and unsuccessful HTTP responses complete without a load
  callback. Other runtime failures reject the returned promise.

## Tests

- Unit and integration tests in Vitest with TypeScript.
- Browser E2E tests in Playwright with TypeScript.
- Browser matrix: Chromium, Firefox, WebKit, Pixel 7 mobile Chromium, mobile
  Firefox emulation, and iPhone 15 mobile WebKit.
- Coverage: 100% statements, branches, functions, and lines.

## License

Apache-2.0
