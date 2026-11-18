import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import type { NativeRemoteBridge } from '../src/native/relay-protocol.ts'
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), controllers: vi.fn(), source: vi.fn() }))
vi.mock('../src/native/runtime.ts', () => ({ createNativeWorkspaceRuntime: mocks.runtime }))
vi.mock('../src/native/controllers.ts', () => ({ createNativeControllers: mocks.controllers }))
vi.mock('../src/native/source.ts', () => ({ registerNativeSource: mocks.source }))
import { NativeClientManager } from '../src/native/client-manager.ts'
function fixture() {
  const ctx = new Context()
  const generation = createSnapshotStore<object | undefined>({})
  const list = createSnapshotStore({ items: [{ workspaceId: 'w', title: 'Linux', path: '/linux' }] })
  const runtime = { connection: { generation }, dispose: vi.fn(async () => {}) }
  const controllers = { workspaces: { list }, dispose: vi.fn(async () => {}) }
  const source = { setOnline: vi.fn(), dispose: vi.fn(async () => {}) }
  mocks.runtime.mockReset().mockResolvedValue(runtime)
  mocks.controllers.mockReset().mockResolvedValue(controllers)
  mocks.source.mockReset().mockResolvedValue(source)
  const bridge = { connect: vi.fn(async () => ({ lease: 'lease', address: 'https://linux.example' })), release: vi.fn(async () => {}) } as unknown as NativeRemoteBridge
  const manager = new NativeClientManager(ctx, bridge, [])
  return { ctx, manager, bridge, runtime, controllers, source, generation }
}
describe('native client connection ownership', () => {
  it('discovers a workspace, maps only a listed row and gates the source with connection generations', async () => {
    const f = fixture()
    try {
      await f.manager.connect('https://linux.example', 'token')
      expect(f.manager.state.getSnapshot().workspaces).toEqual([{ id: 'w', title: 'Linux', path: '/linux' }])
      await expect(f.manager.map('other')).rejects.toThrow('existing')
      await f.manager.map('w')
      expect(f.manager.state.getSnapshot().phase).toBe('mapped')
      f.generation.set(undefined)
      expect(f.source.setOnline).toHaveBeenLastCalledWith(false)
      expect(f.manager.state.getSnapshot().online).toBe(false)
      await f.manager.disconnect()
      expect(f.source.dispose).toHaveBeenCalledOnce()
      expect(f.controllers.dispose).toHaveBeenCalledOnce()
      expect(f.runtime.dispose).toHaveBeenCalledOnce()
      expect(f.bridge.release).toHaveBeenCalledWith('lease')
    } finally { await f.manager.dispose(); await f.ctx.fiber.dispose() }
  })
  it('releases a late authenticated lease when disconnected during login', async () => {
    const f = fixture()
    const login = Promise.withResolvers<{ lease: string; address: string }>()
    vi.mocked(f.bridge.connect).mockReturnValue(login.promise)
    const pending = f.manager.connect('https://linux.example', 'token')
    await f.manager.disconnect()
    login.resolve({ lease: 'late', address: 'https://linux.example' })
    await pending
    expect(f.bridge.release).toHaveBeenCalledWith('late')
    expect(mocks.runtime).not.toHaveBeenCalled()
    await f.manager.dispose(); await f.ctx.fiber.dispose()
  })
  it('withdraws a late mapping if disconnected while registration is pending', async () => {
    const f = fixture()
    await f.manager.connect('https://linux.example', 'token')
    const registration = Promise.withResolvers<typeof f.source>()
    mocks.source.mockReturnValue(registration.promise)
    const pending = f.manager.map('w')
    await f.manager.disconnect()
    registration.resolve(f.source)
    await pending
    expect(f.source.dispose).toHaveBeenCalledOnce()
    expect(f.manager.state.getSnapshot().phase).toBe('idle')
    await f.manager.dispose(); await f.ctx.fiber.dispose()
  })
  it('disposes an assembled runtime when controller setup fails', async () => {
    const f = fixture()
    mocks.controllers.mockRejectedValue(new Error('controller failed'))
    await f.manager.connect('https://linux.example', 'token')
    expect(f.manager.state.getSnapshot()).toMatchObject({ phase: 'error', error: 'controller failed' })
    expect(f.runtime.dispose).toHaveBeenCalledOnce()
    expect(f.bridge.release).toHaveBeenCalledWith('lease')
    await f.manager.dispose(); await f.ctx.fiber.dispose()
  })
})

it('clears disconnected UI state even if its desktop lease has already been withdrawn', async () => {
  const f = fixture()
  await f.manager.connect('https://linux.example', 'token')
  vi.mocked(f.bridge.release).mockRejectedValueOnce(new Error('lease unavailable'))
  await expect(f.manager.disconnect()).rejects.toThrow('lease unavailable')
  expect(f.manager.state.getSnapshot().phase).toBe('idle')
  expect(f.runtime.dispose).toHaveBeenCalledOnce()
  await f.manager.dispose(); await f.ctx.fiber.dispose()
})
