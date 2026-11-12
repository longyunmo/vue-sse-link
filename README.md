# vue-sse-link

A small Vue 3 plugin for consuming Server-Sent Events (SSE). It is designed to be published as a reusable npm package and imported by other Vue projects.

## Install

Install from npm:

```bash
npm install vue-sse-link
```

You can also install directly from the public GitHub repository:

```bash
npm install github:longyunmo/vue-sse-link
```

The Git install runs `prepare` to build the package. To install from a local clone, run `npm install /path/to/vue-sse-link` in the consuming project. The import name stays `vue-sse-link` in all cases. GitHub installation requires the repository to be public.

Vue 3 is a peer dependency. This package uses the browser's native `EventSource` and manages reconnect attempts with a capped backoff delay. `EventSource` supports `withCredentials` but not arbitrary request headers; pass an EventSource polyfill through `eventSourceFactory` if your server requires bearer headers.

## Register once

```ts
import { createApp } from 'vue'
import App from './App.vue'
import VueSSE from 'vue-sse-link'

const app = createApp(App)
app.use(VueSSE)
app.mount('#app')
```

## Connect and listen

```ts
import { onUnmounted } from 'vue'
import { useSSE } from 'vue-sse-link'

const sse = useSSE()
sse.connect('https://api.example.com/events', { withCredentials: true })

const off = sse.on('notification', (message) => {
  console.log(message.data) // JSON is parsed automatically when valid
})

onUnmounted(() => {
  off()
  sse.close()
})
```

## Heartbeat and reconnect

Heartbeat settings belong to `connect()` so each caller can choose the interval and payload. The interval defaults to 3 seconds. Any received SSE message restarts that interval. Since `EventSource` only receives data, set a heartbeat `url` for the built-in JSON POST or provide `send` to use your own transport:

```ts
sse.connect('/api/events', {
  heartbeat: {
    interval: 3000,
    data: { type: 'ping', clientId: 'web-1' },
    url: '/api/heartbeat',
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  },
  reconnect: { delay: 1000, maxDelay: 30000 },
})
```

Reconnect is enabled by default and retries with an increasing delay, capped at 30 seconds. Set `reconnect: false` to disable it. Heartbeats are disabled unless `heartbeat.url` or `heartbeat.send` is provided. The plugin's auto-connect form accepts the same options:

```ts
app.use(VueSSE, {
  url: '/api/events',
  autoConnect: true,
  heartbeat: {
    interval: 5000,
    url: '/api/heartbeat',
    data: { type: 'ping' },
  },
})
```

The client exposes readonly reactive `status`, `lastMessage`, and `error` refs. Status values are `idle`, `connecting`, `open`, `closed`, and `error`. To observe the default `message` event use `on('message', handler)` or the `onMessage` connection option. Named server events are registered with `on(eventName, handler)`.

```ts
const sse = useSSE()
sse.connect('/api/events', {
  parseJSON: false,
  onOpen: () => console.log('connected'),
  onError: () => console.warn('connection interrupted'),
  onMessage: (message) => console.log(message.raw),
})
```

## Token authentication

Native `EventSource` cannot set an `Authorization` header. When your SSE endpoint accepts a token in its query string, provide a getter that reads the application's token cache and returns `null` if the token is missing or expired. The getter runs on every connection and retry. The query parameter defaults to `token` and can be changed with `paramName`:

```ts
function getValidToken(): string | null {
  const token = localStorage.getItem('access_token')
  const expiresAt = Number(localStorage.getItem('access_token_expires_at'))
  return token && expiresAt > Date.now() ? token : null
}

const sse = useSSE()
sse.connect('/api/events?channel=updates', {
  auth: {
    getToken: getValidToken,
    paramName: 'token',
  },
})
```

After saving a refreshed token to the cache, call `sse.reconnect()` to close the old connection and connect with the new token. On logout, clear the application's token cache and call `sse.close()`:

```ts
saveTokenToCache(newToken)
sse.reconnect()

clearTokenCache()
sse.close()
```

The library does not own or clear your token cache. Query-string tokens can appear in server and proxy logs, so use HTTPS and short-lived tokens. If your server supports authorization headers, provide an `eventSourceFactory` backed by an EventSource polyfill instead.

You can also create an isolated client without Vue injection by calling `createSSEClient()`. This is useful in tests or non-component modules.

## Build

```bash
npm install
npm run build
npm pack --dry-run
```

To publish a release to npm, sign in with `npm login`, then run `npm publish` from the repository root. The package name `vue-sse-link` must be available on npm, and the publishing account needs permission to use it.

The build emits ESM, CommonJS, and TypeScript declarations in `dist/`. The package leaves Vue external so consuming applications use their own Vue installation.

## License

MIT
