export type URLString = `${'http' | 'https'}://${string}`

export type WriteOperation = {
  kind: 'delete' | 'store'
  url: URLString
}
