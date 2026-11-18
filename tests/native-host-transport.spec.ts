import { describe, expect, it, vi } from 'vitest'
import { RemoteHostConnector } from '../src/native/connector.ts'
import { createHostTransport } from '../src/native/host-transport.ts'

describe('Host-owned native transport', () => {
  it('routes only authenticated API HTTP and the exact mux authority', async () => {
    const send = vi.fn(async (_url: string, init: RequestInit) => init.method === 'GET'
      ? new Response(null, { status: 303, headers: { location: '/', 'set-cookie': 'dsh-auth-fixture=private; HttpOnly; Secure' } })
      : new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const connector = new RemoteHostConnector('https://linux.example', send)
    await connector.login('launch-token')
    const socket = { readyState: 0, send: vi.fn(), close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const factory = vi.fn(() => ({ socket, closed: new Promise<void>(() => {}), close: socket.close }))
    const transport = createHostTransport(connector, factory)
    await transport.fetch!('api/remote/session/list', { method: 'POST' })
    expect(send.mock.calls[1]![0]).toBe('https://linux.example/api/remote/session/list')
    expect(new Headers(send.mock.calls[1]![1].headers).get('cookie')).toBe('dsh-auth-fixture=private')
    expect(transport.createWebSocket!('wss://linux.example/api/remote.mux')).toBe(socket)
    expect(factory).toHaveBeenCalledTimes(1)
    for (const url of ['https://elsewhere.example/api/remote/session/list', 'https://linux.example/api/remote/session/list?token=x']) {
      expect(() => transport.fetch!(url, {})).toThrow('destination refused')
    }
    for (const url of ['wss://elsewhere.example/api/remote.mux', 'wss://linux.example/api/remote.mux?token=x', 'ws://linux.example/api/remote.mux']) {
      expect(() => transport.createWebSocket!(url)).toThrow('destination refused')
    }
    connector.dispose()
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(() => transport.createWebSocket!('wss://linux.example/api/remote.mux')).toThrow('disposed')
    await expect(transport.fetch!('api/remote/session/list', {})).rejects.toThrow('disposed')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
