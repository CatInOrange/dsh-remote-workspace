import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { RemoteResult, TypertRemoteContribution, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { createNativeWorkspaceRuntime } from '../src/native/runtime.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap { 'nativeProbe/read': () => Promise<RemoteResult<string>> }
  interface TypertRemoteNamespaceMap { nativeProbe: TypertRemoteNamespace<'nativeProbe'> }
}
const contribution: TypertRemoteContribution = {
  package: '@fixture/native', descriptors: [{
    id: '@fixture/native#nativeProbe/read', service: 'nativeProbe', namespace: 'nativeProbe', method: 'read',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: '@fixture#String', create: () => z.string() },
  }],
}
function carrier(marker: string) {
  const closed = vi.fn()
  const call = vi.fn(async () => ({ ok: true as const, value: marker }))
  return { closed, call, input: { address: 'https://linux.example', transport: { rpc: {
    call,
    open: async function* (_channel: string, _endpoint: string, _payload: unknown, signal: AbortSignal) {
      try {
        yield { type: 'ready', clientId: marker, host: { home: '/linux' } }
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      } finally { closed() }
    },
  } } } }
}
describe('native remote runtime assembly', () => {
  it('isolates namespaces, transport, authority and disposal for two instances', async () => {
    const a = carrier('a'), b = carrier('b')
    const one = await createNativeWorkspaceRuntime(a.input, [contribution])
    const two = await createNativeWorkspaceRuntime(b.input, [contribution])
    try {
      expect(one.connection.isLoopback).toBe(false)
      expect(two.connection.isLoopback).toBe(false)
      await expect(one.remote.nativeProbe.read()).resolves.toEqual({ ok: true, value: 'a' })
      await expect(two.remote.nativeProbe.read()).resolves.toEqual({ ok: true, value: 'b' })
      await vi.waitFor(() => expect(one.connection.generation.getSnapshot()).toBeDefined())
      const borrowedRead = one.remote.nativeProbe.read
      const callsBeforeDisposal = a.call.mock.calls.length
      await one.dispose()
      expect(a.closed).toHaveBeenCalled()
      expect(b.closed).not.toHaveBeenCalled()
      await expect(two.remote.nativeProbe.read()).resolves.toEqual({ ok: true, value: 'b' })
      expect(one.remote.nativeProbe).toBeUndefined()
      await expect(borrowedRead()).resolves.toMatchObject({ ok: false })
      expect(a.call).toHaveBeenCalledTimes(callsBeforeDisposal)
    } finally { await Promise.all([one.dispose(), two.dispose()]) }
  })
  it('rejects incomplete carriers rather than using page fetch or cookies', async () => {
    await expect(createNativeWorkspaceRuntime({ address: 'https://linux.example', transport: {} }, []))
      .rejects.toThrow('HTTP and authenticated sockets')
    await expect(createNativeWorkspaceRuntime({ address: 'https://linux.example', transport: { rpc: { call: vi.fn() } } }, []))
      .rejects.toThrow('provide streams')
    await expect(createNativeWorkspaceRuntime({ address: 'https://linux.example?token=secret', transport: {} }, []))
      .rejects.toThrow('credential-free')
    await expect(createNativeWorkspaceRuntime({ address: 'https://linux.example', transport: { ownsHost: true } }, []))
      .rejects.toThrow('cannot own')
  })
  it('releases the event carrier when a later namespace fails to mount', async () => {
    const remote = carrier('failed')
    await expect(createNativeWorkspaceRuntime(remote.input, [contribution, contribution])).rejects.toThrow()
    await vi.waitFor(() => expect(remote.closed).toHaveBeenCalled())
  })
})
