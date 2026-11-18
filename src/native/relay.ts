import type { ClientTransportHooks, ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client'
import type { NativeRemoteBridge, NativeRemoteEvent } from './relay-protocol.ts'
import type { NativeRuntimeTransport } from './runtime.ts'

type SocketEvent = Parameters<ConnectionWebSocket['addEventListener']>[0]
/** Turn the narrow desktop lease into native transport hooks; no ambient network fallback. */
export function createNativeRelay(bridge: NativeRemoteBridge, lease: { lease: string; address: string }): NativeRuntimeTransport {
  const address = new URL(lease.address)
  if (address.protocol !== 'https:' || address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new Error('Invalid remote relay origin')
  const transport: ClientTransportHooks = {
    async fetch(input, init) {
      const url = new URL(input, address)
      if (url.origin !== address.origin || url.search || url.hash || url.username || url.password) throw new Error('Remote relay destination refused')
      if (init.method !== 'POST' && init.method !== 'GET') throw new Error('Unsupported remote relay method')
      if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new Error('Unsupported remote relay request body')
      init.signal?.throwIfAborted()
      const id = crypto.randomUUID()
      const cancel = (): void => { void bridge.cancel(lease.lease, id).catch(() => {}) }
      // Invoke first so an immediately following cancellation is ordered after the request in IPC.
      const pending = bridge.request(lease.lease, {
        id, path: url.pathname, method: init.method,
        ...(typeof init.body === 'string' ? { body: new TextEncoder().encode(init.body) } : {}),
        contentType: 'application/json',
      })
      init.signal?.addEventListener('abort', cancel, { once: true })
      try {
        const response = await pending
        init.signal?.throwIfAborted()
        return new Response(response.body as BodyInit, { status: response.status,
          ...(response.contentType === null ? {} : { headers: { 'content-type': response.contentType } }),
        })
      } finally { init.signal?.removeEventListener('abort', cancel) }
    },
    createWebSocket(url) {
      const expected = new URL('api/remote.mux', address); expected.protocol = 'wss:'
      if (url !== expected.href) throw new Error('Remote relay socket destination refused')
      const id = crypto.randomUUID()
      let state = 0
      const listeners = new Map<SocketEvent, Map<(event: never) => void, boolean>>()
      const emit = (type: SocketEvent, event: unknown): void => {
        const callbacks = listeners.get(type)
        for (const [listener, once] of [...callbacks ?? []]) {
          if (once) callbacks?.delete(listener)
          listener(event as never)
        }
      }
      let unsubscribe = (): void => {}
      const receive = (event: NativeRemoteEvent): void => {
        if (event.id !== id || state === 3) return
        if (event.type === 'open') { if (state !== 0) return; state = 1 }
        if (event.type === 'close') { state = 3; unsubscribe() }
        emit(event.type, event.type === 'message' ? { data: event.data } : {})
      }
      unsubscribe = bridge.subscribe(receive)
      const fail = (): void => { if (state === 3) return; emit('error', {}); state = 3; unsubscribe(); emit('close', {}) }
      void bridge.open(lease.lease, id).catch(fail)
      return {
        get readyState() { return state },
        send(data) {
          if (state !== 1) throw new Error('Remote relay socket is not open')
          void bridge.send(lease.lease, id, data).catch(fail)
        },
        close() {
          if (state >= 2) return
          state = 2
          void bridge.close(lease.lease, id).then(() => { receive({ id, type: 'close' }) }, fail)
        },
        addEventListener(type, listener, options) {
          let callbacks = listeners.get(type)
          if (callbacks === undefined) { callbacks = new Map(); listeners.set(type, callbacks) }
          if (!callbacks.has(listener as (event: never) => void)) callbacks.set(listener as (event: never) => void, options?.once === true)
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener as (event: never) => void) },
      }
    },
    streamBaseUrl: address.href,
  }
  return { address: address.origin, transport }
}
