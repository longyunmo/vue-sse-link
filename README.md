# vue-sse-link

A small Vue 3 plugin for consuming Server-Sent Events (SSE). It is designed to be published as a reusable npm package and imported by other Vue projects.

## Install

After publishing this package to npm:

```bash
npm install vue-sse-link
```

Or install directly from a public GitHub repository (replace `YOUR_ACCOUNT`):

```bash
npm install github:YOUR_ACCOUNT/vue-sse-link
```

The Git install runs `prepare` to build the package. To install from a local clone, run `npm install /path/to/vue-sse-link` in the consuming project. The import name stays `vue-sse-link` in all three cases.

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

You can also create an isolated client without Vue injection by calling `createSSEClient()`. This is useful in tests or non-component modules.

## Build

```bash
npm install
npm run build
npm publish
```

The build emits ESM, CommonJS, and TypeScript declarations in `dist/`. The package leaves Vue external so consuming applications use their own Vue installation.

## License

MIT
