import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { NativeControllers } from '../src/native/controllers.ts'
import { registerNativeSource } from '../src/native/source.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'
import { describe, expect, it, vi } from 'vitest'
const registration = vi.hoisted(() => ({ workspace: vi.fn() }))
vi.mock('@deepseek-ai/dsh-api-workspace-controller/client', () => ({ registerWorkspaceSource: registration.workspace }))
function fixture() {
  const ctx = new Context()
  const withdraw = vi.fn()
  const registerSource = vi.fn((child: Context) => { child.effect(() => withdraw); return withdraw })
  ctx.provide('sessions', { registerSource } as never)
  ctx.provide('workspaces', {} as never)
  const workspaces = createSnapshotStore({ items: [{ workspaceId: 'w', sessionIds: ['s'] }], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null })
  const sessions = createSnapshotStore({ ids: ['s', 'private'], byId: { s: { id: 's' }, private: { id: 'private' } }, phase: 'ready', projectionsBySession: {} })
  const controllers = { sessions: { list: sessions, searchResultLimit: 30, subagentAddress: () => undefined }, workspaces: { list: workspaces } } as unknown as NativeControllers
  return { ctx, controllers, registerSource, withdraw, workspaces }
}
describe('native mapping lifetime', () => {
  it('registers both sources, follows membership, rejects offline access and withdraws together', async () => {
    registration.workspace.mockReset()
    const f = fixture()
    try {
      const source = await registerNativeSource(f.ctx, f.controllers, 'w', 'remote')
      expect(f.registerSource).toHaveBeenCalledOnce()
      expect(registration.workspace).toHaveBeenCalledOnce()
      const id = new SingleWorkspaceMapping('w').uiId('session', 's')
      source.setOnline(true)
      expect(source.sessions.list.getSnapshot().ids).toEqual([id])
      f.workspaces.set({ ...f.workspaces.getSnapshot(), items: [{ workspaceId: 'w', sessionIds: [] }] })
      expect(source.sessions.list.getSnapshot().ids).toEqual([])
      source.setOnline(false)
      expect(() => source.sessions.retain(id as never, { source: 'gateway' })).toThrow('offline')
      await source.dispose()
      expect(f.withdraw).toHaveBeenCalledOnce()
      expect(() => source.setOnline(true)).toThrow('disposed')
      expect(source.sessions.list.getSnapshot().ids).toEqual([])
    } finally { await f.ctx.fiber.dispose() }
  })
  it('rolls back Session registration if Workspace registration fails', async () => {
    registration.workspace.mockReset().mockImplementation(() => { throw new Error('workspace failed') })
    const f = fixture()
    try {
      await expect(registerNativeSource(f.ctx, f.controllers, 'w', 'broken')).rejects.toThrow('workspace failed')
      expect(f.withdraw).toHaveBeenCalledOnce()
    } finally { await f.ctx.fiber.dispose() }
  })
})
