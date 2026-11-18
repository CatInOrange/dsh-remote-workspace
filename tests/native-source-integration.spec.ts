import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WorkspaceController, type ClientWorkspaceModel } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { ResourceAccessSources } from '@native-harness/packages/api/remote-access/src/client/sources.ts'
import { SourceSessions } from '@native-harness/packages/api/session-controller/src/client/sessions/sources.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { NativeControllers } from '../src/native/controllers.ts'
import { registerNativeSource } from '../src/native/source.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'
import { expect, it, vi } from 'vitest'
it('composes actual source facades and reserves identities after unmapping without local fallback', async () => {
  const ctx = new Context()
  const localRetain = vi.fn()
  const localGrant = createSnapshotStore(true), remoteGrant = createSnapshotStore(false)
  const access = new ResourceAccessSources(() => localGrant)
  ctx.provide('remoteAccess', { source: access.source.bind(access), registerSource: access.register.bind(access) } as never)
  const remoteAccess = { source: vi.fn(() => remoteGrant) } as never
  const local = { list: createSnapshotStore({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), retain: localRetain, searchResultLimit: 30 } as unknown as ISessions
  const root = new SourceSessions(ctx, local)
  ctx.provide('sessions', root)
  const empty = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
  const localWorkspaces = new WorkspaceController(ctx, createSnapshotStore(empty) as unknown as ClientWorkspaceModel)
  const workspaces = createSnapshotStore({ ...empty, items: [{ workspaceId: 'w', sessionIds: ['s'] }] })
  const controllers = { sessions: { list: createSnapshotStore({ ids: ['s'], byId: { s: { id: 's' } }, phase: 'ready', projectionsBySession: {} }), subagentAddress: () => undefined, searchResultLimit: 30 }, workspaces: { list: workspaces } } as unknown as NativeControllers
  try {
    const source = await registerNativeSource(ctx, controllers, 'w', 'remote', remoteAccess)
    source.setOnline(true)
    const mapping = new SingleWorkspaceMapping('w')
    const id = mapping.uiId('session', 's') as never
    const permission = access.source('session', id, 'session/prompt')
    expect(permission.getSnapshot()).toBe(false)
    remoteGrant.set(true)
    expect(permission.getSnapshot()).toBe(true)
    expect(root.list.getSnapshot().ids).toEqual([id])
    expect(localWorkspaces.list.getSnapshot().items[0]?.workspaceId).toBe(mapping.uiId('workspace', 'w'))
    source.setOnline(false)
    expect(permission.getSnapshot()).toBe(false)
    expect(() => root.retain(id, { source: 'gateway' })).toThrow('offline')
    source.setOnline(true)
    expect(permission.getSnapshot()).toBe(true)
    await source.dispose()
    expect(permission.getSnapshot()).toBe(false)
    expect(root.list.getSnapshot().ids).toEqual([])
    expect(localWorkspaces.list.getSnapshot().items).toEqual([])
    expect(() => root.retain(id, { source: 'gateway' })).toThrow()
    await expect(localWorkspaces.rename(mapping.uiId('workspace', 'w') as never, 'x')).rejects.toThrow()
    expect(localRetain).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})
