import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { resolve, sep } from 'node:path'
import type * as Storage from '../../../src/index.js'

const CACHE_NAME = '@sovereignbase/storage/objects'
const HOST = 'https://objects.example/'
const ID = 'browser-object'
const bundlePath = resolve(process.cwd(), 'dist', 'index.js')
const msgpackRoot = resolve(
  process.cwd(),
  'node_modules',
  '@msgpack',
  'msgpack'
)
const msgpackPrefix = '/node_modules/@msgpack/msgpack/'
let server: Server
let testOrigin: string

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.url === '/dist/index.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(await readFile(bundlePath))
      return
    }

    if (request.url?.startsWith(msgpackPrefix)) {
      const dependencyPath = resolve(
        msgpackRoot,
        request.url.slice(msgpackPrefix.length)
      )
      if (!dependencyPath.startsWith(msgpackRoot + sep)) {
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
        {"imports":{"@msgpack/msgpack":"${msgpackPrefix}dist.esm/index.mjs"}}
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

test('persists remotely, hydrates the DOM, and reuses the browser cache', async ({
  page,
}) => {
  let persisted: Buffer | undefined
  let reads = 0

  await page.route(`${HOST}**`, async (route) => {
    const request = route.request()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
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
    async ({ host, id }) => {
      const moduleUrl = '/dist/index.js'
      const { storeObject } = (await import(moduleUrl)) as typeof Storage
      const key = Uint8Array.from({ length: 32 }, (_, index) => index)

      void storeObject(
        id,
        host,
        60_000,
        key,
        { title: 'Hydrated' },
        (bytes) => {
          void fetch(host + id, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes,
          })
        }
      )
    },
    { host: HOST, id: ID }
  )

  await expect.poll(() => persisted?.byteLength ?? 0).toBeGreaterThan(0)

  await page.evaluate(async (cacheName) => caches.delete(cacheName), CACHE_NAME)
  await page.evaluate(
    ({ host, id }) => {
      const app = document.querySelector<HTMLElement>('#app')
      if (!app) throw new Error('Missing app element')

      app.dataset.shell = 'ready'
      app.textContent = 'Loading'

      const moduleUrl = '/dist/index.js'
      void import(moduleUrl).then(({ loadObject }) => {
        const key = Uint8Array.from({ length: 32 }, (_, index) => index)
        void loadObject(id, host, 60_000, key, (object: unknown) => {
          app.textContent = (object as { title: string }).title
          app.dataset.hydrated = 'true'
        })
      })
    },
    { host: HOST, id: ID }
  )

  await expect(page.locator('#app')).toHaveAttribute('data-shell', 'ready')
  await expect(page.locator('#app')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator('#app')).toHaveText('Hydrated')
  expect(reads).toBe(1)

  const cacheHeaders = await page.evaluate(
    async ({ cacheName, url }) => {
      const cache = await caches.open(cacheName)
      const response = await cache.match(url)
      return {
        cacheControl: response?.headers.get('cache-control'),
        date: response?.headers.get('date'),
        expires: response?.headers.get('expires'),
      }
    },
    { cacheName: CACHE_NAME, url: `${HOST}${ID}` }
  )
  expect(cacheHeaders.cacheControl).toBe('public, max-age=60, must-revalidate')
  expect(Date.parse(cacheHeaders.expires ?? '')).toBeGreaterThan(
    Date.parse(cacheHeaders.date ?? '')
  )

  await page.evaluate(
    async ({ host, id }) => {
      const moduleUrl = '/dist/index.js'
      const { loadObject } = (await import(moduleUrl)) as typeof Storage
      const key = Uint8Array.from({ length: 32 }, (_, index) => index)
      await loadObject(id, host, 60_000, key, () => undefined)
    },
    { host: HOST, id: ID }
  )
  expect(reads).toBe(1)
})
