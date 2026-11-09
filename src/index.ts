import { inject, readonly, shallowRef, type App, type InjectionKey, type Plugin, type Ref } from 'vue'

export type SSEStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface SSEMessage<T = unknown> {
  data: T
  raw: string
  event: string
  lastEventId: string
  origin: string
}

export interface SSEConnectOptions {
  /** Whether to send cookies for cross-origin requests. */
  withCredentials?: boolean
  /** Parse message data as JSON. Invalid JSON is returned as the original string. */
  parseJSON?: boolean
  /** Called when an EventSource is created. Use a polyfill here if headers are required. */
  eventSourceFactory?: (url: string, init?: EventSourceInit) => EventSource
  /** Called for every message, including named events registered with on(). */
  onMessage?: (message: SSEMessage) => void
  onOpen?: (event: Event) => void
  onError?: (event: Event) => void
  /** Send a caller-defined heartbeat. EventSource itself is receive-only. */
  heartbeat?: {
    /** Milliseconds between heartbeats. Defaults to 3000. */
    interval?: number
    /** Payload passed to send(). */
    data?: unknown
    /** Optional endpoint; sends a JSON POST when send() is omitted. */
    url?: string
    /** HTTP method used with url. Defaults to POST. */
    method?: string
    /** Extra headers used with url. */
    headers?: Record<string, string>
    /** Send the payload to your heartbeat endpoint or transport. */
    send?: (data: unknown) => void | Promise<void>
  }
  /** Automatic reconnect settings. Set false to disable. Defaults to enabled. */
  reconnect?: false | {
    /** Initial delay in milliseconds. Defaults to 1000. */
    delay?: number
    /** Maximum delay in milliseconds. Defaults to 30000. */
    maxDelay?: number
  }
}

export interface SSEClient {
  readonly status: Readonly<Ref<SSEStatus>>
  readonly lastMessage: Readonly<Ref<SSEMessage | null>>
  readonly error: Readonly<Ref<Event | Error | null>>
  connect(url: string, options?: SSEConnectOptions): void
  /** Subscribe to a named server event; returns an unsubscribe function. */
  on<T = unknown>(eventName: string, handler: (message: SSEMessage<T>) => void): () => void
  close(): void
}

export interface VueSSEOptions extends SSEConnectOptions {
  /** Optional default URL; connect() can still supply a URL explicitly. */
  url?: string
  /** Connect automatically after app.use(VueSSE, options). */
  autoConnect?: boolean
}

export const SSE_KEY: InjectionKey<SSEClient> = Symbol('VueSSE')

export function createSSEClient(): SSEClient {
  const status = shallowRef<SSEStatus>('idle')
  const lastMessage = shallowRef<SSEMessage | null>(null)
  const error = shallowRef<Event | Error | null>(null)
  const listeners = new Map<string, Set<(message: SSEMessage) => void>>()
  const attachedListeners = new Map<string, EventListener>()
  let source: EventSource | null = null
  let generation = 0
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let retryCount = 0
  let activeUrl = ''
  let activeOptions: SSEConnectOptions = {}

  const client: SSEClient = {
    status: readonly(status),
    lastMessage: readonly(lastMessage),
    error: readonly(error),
    connect(url, options = {}) {
      if (typeof EventSource === 'undefined' && !options.eventSourceFactory) {
        throw new Error('EventSource is unavailable. Provide eventSourceFactory for this environment.')
      }
      client.close()
      retryCount = 0
      activeUrl = url
      activeOptions = options
      openConnection()
    },
    on(eventName, handler) {
      const handlers = listeners.get(eventName) ?? new Set()
      handlers.add(handler as (message: SSEMessage) => void)
      listeners.set(eventName, handlers)
      if (source && eventName !== 'message' && !attachedListeners.has(eventName)) {
        attachEventListener(eventName, generation)
      }
      return () => {
        handlers.delete(handler as (message: SSEMessage) => void)
        if (handlers.size === 0) {
          listeners.delete(eventName)
          const attached = attachedListeners.get(eventName)
          if (attached) source?.removeEventListener(eventName, attached)
          attachedListeners.delete(eventName)
        }
      }
    },
    close() {
      generation++
      clearTimeout(heartbeatTimer)
      clearTimeout(reconnectTimer)
      clearTimeout(stableTimer)
      heartbeatTimer = undefined
      reconnectTimer = undefined
      stableTimer = undefined
      source?.close()
      source = null
      attachedListeners.clear()
      if (status.value !== 'idle') status.value = 'closed'
    },
  }

  function openConnection() {
    const url = activeUrl
    const options = activeOptions
    const currentGeneration = ++generation
    status.value = 'connecting'
    error.value = null
    const factory = options.eventSourceFactory ?? ((target, init) => new EventSource(target, init))
    const nextSource = factory(url, { withCredentials: options.withCredentials })
    source = nextSource

    nextSource.onopen = (event) => {
        if (generation !== currentGeneration) return
        status.value = 'open'
        clearTimeout(stableTimer)
        stableTimer = setTimeout(() => { retryCount = 0 }, 30000)
        resetHeartbeat(currentGeneration)
        options.onOpen?.(event)
      }
    nextSource.onmessage = (event) => {
        if (generation !== currentGeneration) return
        dispatch(event, 'message', currentGeneration)
      }
    nextSource.onerror = (event) => {
        if (generation !== currentGeneration) return
        error.value = event
        status.value = 'error'
        options.onError?.(event)
        if (options.reconnect === false) {
          clearTimeout(heartbeatTimer)
          nextSource.close()
          source = null
          attachedListeners.clear()
          status.value = 'closed'
          return
        }
        clearTimeout(stableTimer)
        clearTimeout(heartbeatTimer)
        nextSource.close()
        source = null
        attachedListeners.clear()
        status.value = 'connecting'
        const initialDelay = options.reconnect?.delay ?? 1000
        const maxDelay = options.reconnect?.maxDelay ?? 30000
        const delay = Math.min(initialDelay * (2 ** retryCount), maxDelay)
        retryCount++
        reconnectTimer = setTimeout(openConnection, delay)
    }

    for (const eventName of listeners.keys()) {
      if (eventName !== 'message') attachEventListener(eventName, currentGeneration)
    }
  }

  function dispatch(event: MessageEvent, eventName: string, eventGeneration: number) {
    if (generation !== eventGeneration) return
    const message = toMessage(event, eventName, activeOptions.parseJSON)
    lastMessage.value = message
    activeOptions.onMessage?.(message)
    listeners.get(eventName)?.forEach((handler) => handler(message))
    resetHeartbeat(eventGeneration)
  }

  function resetHeartbeat(eventGeneration: number) {
    clearTimeout(heartbeatTimer)
    const heartbeat = activeOptions.heartbeat
    if (!heartbeat || !source || (!heartbeat.send && !heartbeat.url)) return
    heartbeatTimer = setTimeout(async () => {
      if (generation !== eventGeneration || !source) return
      try {
        if (heartbeat.send) {
          await heartbeat.send(heartbeat.data)
        } else if (heartbeat.url) {
          const response = await fetch(heartbeat.url, {
            method: heartbeat.method ?? 'POST',
            headers: { 'Content-Type': 'application/json', ...heartbeat.headers },
            body: JSON.stringify(heartbeat.data),
          })
          if (!response.ok) throw new Error(`Heartbeat failed with HTTP ${response.status}`)
        }
      } catch (cause) {
        error.value = cause instanceof Error ? cause : new Error(String(cause))
      }
      if (generation === eventGeneration && source) resetHeartbeat(eventGeneration)
    }, Math.max(1, heartbeat.interval ?? 3000))
  }

  function attachEventListener(eventName: string, eventGeneration: number) {
    if (!source || attachedListeners.has(eventName)) return
    const listener: EventListener = (rawEvent) => {
      dispatch(rawEvent as MessageEvent, eventName, eventGeneration)
    }
    attachedListeners.set(eventName, listener)
    source.addEventListener(eventName, listener)
  }
  return client
}

function toMessage(event: MessageEvent, eventName: string, parseJSON = true): SSEMessage {
  let data: unknown = event.data
  if (parseJSON && typeof event.data === 'string') {
    try { data = JSON.parse(event.data) } catch { /* Keep plain text payloads as strings. */ }
  }
  return { data, raw: String(event.data ?? ''), event: eventName, lastEventId: event.lastEventId ?? '', origin: event.origin ?? '' }
}

export function useSSE(): SSEClient {
  const client = inject(SSE_KEY)
  if (!client) throw new Error('VueSSE is not installed. Call app.use(VueSSE) before useSSE().')
  return client
}

export const VueSSE: Plugin<[VueSSEOptions?]> = {
  install(app: App, options: VueSSEOptions = {}) {
    const client = createSSEClient()
    app.provide(SSE_KEY, client)
    app.config.globalProperties.$sse = client
    if (options.autoConnect && options.url) client.connect(options.url, options)
  },
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $sse: SSEClient
  }
}

export default VueSSE
