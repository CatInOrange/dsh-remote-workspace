import { describe, expect, it, vi } from 'vitest'
import { createNativeRelay } from '../src/native/relay.ts'
import type { NativeRemoteBridge, NativeRemoteEvent } from '../src/native/relay-protocol.ts'
function fixture() {
  const listeners = new Set<(event: NativeRemoteEvent) => void>()
  const bridge: NativeRemoteBridge = {
    connect: vi.fn(), release: vi.fn(), cancel: vi.fn(async () => {}), close: vi.fn(async () => {}),
    request: vi.fn(async () => ({ status: 200, contentType: 'application/json', body: new TextEncoder().encode('{}') })),
    open: vi.fn(async () => {}), send: vi.fn(async () => {}),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const relay = createNativeRelay(bridge, { lease: 'lease', address: 'https://remote.example' })
  return { bridge, relay, listeners, emit(event: NativeRemoteEvent) { for (const listener of [...listeners]) listener(event) } }
}
describe('credential-free native relay', () => {
  it('routes HTTP through its lease and never fetches arbitrary targets', async () => {
    const f = fixture()
    const response = await f.relay.transport.fetch!('api/session/list', { method: 'POST', body: '{}' })
    expect(await response.json()).toEqual({})
    expect(f.bridge.request).toHaveBeenCalledWith('lease', expect.objectContaining({ path: '/api/session/list', body: new TextEncoder().encode('{}') }))
    await expect(f.relay.transport.fetch!('https://elsewhere.example/api/a', { method: 'GET' })).rejects.toThrow('destination')
    expect(f.bridge.request).toHaveBeenCalledOnce()
  })
  it('cancels HTTP and refuses an already cancelled request', async () => {
    const f = fixture()
    const abort = new AbortController()
    const pending = f.relay.transport.fetch!('api/test', { method: 'POST', signal: abort.signal })
    abort.abort()
    await expect(pending).rejects.toThrow()
    expect(f.bridge.cancel).toHaveBeenCalledOnce()
    await expect(f.relay.transport.fetch!('api/test', { method: 'POST', signal: abort.signal })).rejects.toThrow()
    expect(f.bridge.request).toHaveBeenCalledOnce()
  })
  it('projects mux socket events and removes subscriptions on close', async () => {
    const f = fixture()
    const socket = f.relay.transport.createWebSocket!('wss://remote.example/api/remote.mux')
    const id = vi.mocked(f.bridge.open).mock.calls[0]![1]
    const open = vi.fn(), message = vi.fn(), close = vi.fn()
    socket.addEventListener('open', open, { once: true }); socket.addEventListener('message', message); socket.addEventListener('close', close)
    f.emit({ id, type: 'open' }); f.emit({ id, type: 'open' })
    expect(socket.readyState).toBe(1); expect(open).toHaveBeenCalledOnce()
    socket.send('rpc'); expect(f.bridge.send).toHaveBeenCalledWith('lease', id, 'rpc')
    f.emit({ id, type: 'message', data: 'frame' }); expect(message).toHaveBeenCalledWith({ data: 'frame' })
    socket.close(); await Promise.resolve()
    expect(socket.readyState).toBe(3); expect(close).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0)
    expect(() => socket.send('late')).toThrow()
    expect(() => f.relay.transport.createWebSocket!('wss://elsewhere.example/api/remote.mux')).toThrow('destination')
  })
})
