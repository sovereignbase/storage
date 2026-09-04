import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { resolve, sep } from 'node:path'
import { Cryptographic, type CipherKey } from '@sovereignbase/cryptosuite'
import type * as Storage from '../../../src/index.js'

const CACHE_NAME = '@sovereignbase/storage/cache'
const URL = 'https://objects.example/browser-object' as const
const bundlePath = resolve(process.cwd(), 'dist', 'index.js')
const nodeModulesRoot = resolve(process.cwd(), 'node_modules')
const nodeModulesPrefix = '/node_modules/'
let server: Server
let testOrigin: string
let key: CipherKey

test.beforeAll(async () => {
  key = await Cryptographic.cipherMessage.generateKey()
  server = createServer(async (request, response) => {
    if (request.url === '/dist/index.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(await readFile(bundlePath))
      return
    }

    if (request.url?.startsWith(nodeModulesPrefix)) {
      const dependencyPath = resolve(
        nodeModulesRoot,
        request.url.slice(nodeModulesPrefix.length)
      )
      if (!dependencyPath.startsWith(nodeModulesRoot + sep)) {
        response.statusCode = 400
        response.end('Bad request')
        return
      }
      response.setHeader('content-type', 'text/javascript')
      response.end(await readFile(dependencyPath))
      return
    }

    response.setHeader('content-type', 'text/html')
    response.end(`
      <script type="importmap">
        {"imports":{
          "@msgpack/msgpack":"${nodeModulesPrefix}@msgpack/msgpack/dist.esm/index.mjs",
          "@sovereignbase/cryptosuite":"${nodeModulesPrefix}@sovereignbase/cryptosuite/dist/index.js",
          "@sovereignbase/bytecodec":"${nodeModulesPrefix}@sovereignbase/bytecodec/dist/index.js",
          "@sovereignbase/utils":"${nodeModulesPrefix}@sovereignbase/utils/dist/index.js",
          "@noble/ciphers/":"${nodeModulesPrefix}@noble/ciphers/",
          "@noble/curves/":"${nodeModulesPrefix}@noble/curves/",
          "@noble/hashes/":"${nodeModulesPrefix}@noble/hashes/",
          "@noble/post-quantum/":"${nodeModulesPrefix}@noble/post-quantum/"
        }}
      </script>
      <main id="app">Ready</main>
    `)
  })

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListening())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address')
  }
  testOrigin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()))
    server.closeAllConnections()
  })
})

test('syncs queued writes, hydrates the DOM, and reuses the cache', async ({
  page,
}) => {
  let persisted: Buffer | undefined
  let reads = 0
  let deletes = 0

  await page.route(`${URL}*`, async (route) => {
    const request = route.request()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    }

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }

    if (request.method() === 'PUT') {
      persisted = request.postDataBuffer() ?? undefined
      await route.fulfill({ status: 204, headers })
      return
    }

    if (request.method() === 'DELETE') {
      persisted = undefined
      deletes += 1
      await route.fulfill({ status: 204, headers })
      return
    }

    reads += 1
    await route.fulfill({
      status: persisted ? 200 : 404,
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
      },
      body: persisted,
    })
  })

  await page.goto(testOrigin)
  await page.evaluate(
    async ({ url, cipherKey, cacheName }) => {
      const moduleUrl = '/dist/index.js'
      const { storeObject, WriteQueue } = (await import(
        moduleUrl
      )) as typeof Storage

      WriteQueue.onQueued = () => {
        void (async () => {
          const queued = await WriteQueue.dequeue()
          if (!queued) return

          if (queued.operation.kind === 'store') {
            const cached = await (
              await caches.open(cacheName)
            ).match(queued.operation.url)
            if (!cached) throw new Error('Queued object is missing from cache')
            await fetch(queued.operation.url, {
              method: 'PUT',
              headers: { 'content-type': 'application/octet-stream' },
              body: await cached.arrayBuffer(),
            })
          } else {
            await fetch(queued.operation.url, { method: 'DELETE' })
          }

          await queued.finalize()
        })()
      }

      await storeObject(url, { title: 'Hydrated' }, cipherKey)
    },
    { url: URL, cipherKey: key, cacheName: CACHE_NAME }
  )

  await expect.poll(() => persisted?.byteLength ?? 0).toBeGreaterThan(0)

  await page.evaluate(async (cacheName) => caches.delete(cacheName), CACHE_NAME)
  await page.evaluate(
    async ({ url, cipherKey }) => {
      const moduleUrl = '/dist/index.js'
      const { loadObject } = (await import(moduleUrl)) as typeof Storage
      const objectPromise = loadObject(url, cipherKey)

      const app = document.querySelector<HTMLElement>('#app')
      if (!app) throw new Error('Missing app element')

      app.dataset.shell = 'ready'
      app.textContent = 'Loading'

      const object = await objectPromise
      app.textContent = (object as { title: string }).title
      app.dataset.hydrated = 'true'
    },
    { url: URL, cipherKey: key }
  )

  await expect(page.locator('#app')).toHaveAttribute('data-shell', 'ready')
  await expect(page.locator('#app')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator('#app')).toHaveText('Hydrated')
  expect(reads).toBe(1)

  await expect
    .poll(() =>
      page.evaluate(
        async ({ cacheName, url }) => {
          const response = await (await caches.open(cacheName)).match(url)
          return response?.headers.get('cache-control')
        },
        { cacheName: CACHE_NAME, url: URL }
      )
    )
    .toBe('public, max-age=7776000, must-revalidate')

  await page.evaluate(
    async ({ url, cipherKey }) => {
      const moduleUrl = '/dist/index.js'
      const { loadObject } = (await import(moduleUrl)) as typeof Storage
      await loadObject(url, cipherKey)
    },
    { url: URL, cipherKey: key }
  )
  expect(reads).toBe(1)

  await page.evaluate(async (url) => {
    const moduleUrl = '/dist/index.js'
    const { deleteObject } = (await import(moduleUrl)) as typeof Storage
    await deleteObject(url)
  }, URL)
  await expect.poll(() => deletes).toBe(1)
})
