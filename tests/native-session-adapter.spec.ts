import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ISessions, SessionBinding, SessionFace, SessionListState, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { describe, expect, it, vi } from 'vitest'
import { NativeSessionAdapter } from '../src/native/session-adapter.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'
const sid = (id: string) => id as SessionId
function fixture() {
  const context = new Context()
  const snapshot: SessionSnapshot = { sessionId: sid('same'), pendingSubmissions: [], running: false, subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: false, historyWasPartial: false, loadingOlder: false,
    historyLoadStatus: 'idle', promptError: null, blank: false, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false }
  const state = createSnapshotStore(snapshot)
  const accepted = async () => ({ ok: true as const, value: { accepted: true as const } })
  const session: SessionFace = { ...state, sessionId: sid('same'), projections: { faceOf: () => createSnapshotStore(undefined) },
    beginSubmission: vi.fn(), prompt: vi.fn(accepted), readAttachment: vi.fn(), updateQueue: vi.fn(accepted), cancel: vi.fn(accepted),
    rename: vi.fn(), loadOlder: vi.fn(async () => {}), consumeOlder: vi.fn(() => false), loadThrough: vi.fn(async () => {}), command: vi.fn() }
  const binding: SessionBinding = { sessionId: sid('same'), ctx: context as SessionBinding['ctx'], session, eventSource: {} as SessionBinding['eventSource'] }
  const release = vi.fn()
  const reference: SessionReference = { sessionId: sid('same'), binding, ready: Promise.resolve(binding), release, [Symbol.dispose]: release }
  const row = (id: string) => ({ id: sid(id), displayTitle: id, parentId: sid('ancestor'), running: false, retainedBy: {}, blank: false, updatedAt: 0 })
  const list = createSnapshotStore<SessionListState>({ ids: [sid('same'), sid('private')], byId: { same: row('same'), private: row('private') }, phase: 'ready', projectionsBySession: {} })
  const remote: ISessions = { list, searchResultLimit: 30, retain: vi.fn(() => reference), using: vi.fn(), retainInfo: vi.fn(), create: vi.fn(async () => sid('new')),
    subagentAddress: vi.fn(), refreshProjections: vi.fn(async () => {}), refresh: vi.fn(async () => {}), search: vi.fn(async () => ({ ok: true as const, value: { items: [{ sessionId: sid('same'), snippet: 'same' }, { sessionId: sid('private'), snippet: 'private' }], hasMore: false } })),
    fork: vi.fn(async opts => { opts.onCreated?.(sid('fork')); return sid('fork') }), scope: vi.fn(() => binding.ctx), scopeOf: vi.fn(() => sid('same')),
    sessionOf: vi.fn(ctx => ctx === context ? session : undefined), binding: vi.fn(() => binding) }
  let online = true
  const mapping = new SingleWorkspaceMapping('project')
  const adapter = new NativeSessionAdapter({ mapping, remote, getSessionIds: () => ['same'], online: () => online })
  return { adapter, mapping, remote, session, binding, release, context, offline: () => { online = false } }
}
describe('native Session identity adapter', () => {
  it('filters membership and maps outward identities while retaining the remote dispatch context', async () => {
    const f = fixture()
    try {
      const id = sid(f.mapping.uiId('session', 'same'))
      expect(f.adapter.list.getSnapshot().ids).toEqual([id])
      expect(f.adapter.list.getSnapshot().byId[id]?.parentId).toBe(f.mapping.uiId('session', 'ancestor'))
      const ref = f.adapter.retain(id, { source: 'gateway' })
      const binding = await ref.ready
      expect(binding.ctx).toBe(f.context)
      expect(binding.eventSource).toBe(f.binding.eventSource)
      expect(binding.sessionId).toBe(id)
      expect(binding.session.sessionId).toBe(id)
      expect(binding.session.getSnapshot().sessionId).toBe(id)
      expect(binding.session.getSnapshot()).toBe(binding.session.getSnapshot())
      expect(f.adapter.scopeOf(f.context)).toBe(id)
      expect(f.adapter.sessionOf(f.context)).toBe(binding.session)
      await binding.session.cancel()
      expect(f.session.cancel).toHaveBeenCalledOnce()
      expect(f.remote.retain).toHaveBeenCalledWith('same', { source: 'gateway' })
      expect(() => f.adapter.retain(sid(f.mapping.uiId('session', 'private')), { source: 'gateway' })).toThrow('outside')
      f.offline()
      expect(() => binding.session.cancel()).toThrow('offline')
      expect(() => f.adapter.retain(id, { source: 'gateway' })).toThrow('offline')
      expect(f.adapter.scopeOf(f.context)).toBe(id)
      expect(ref.binding).toBe(binding)
      expect(f.adapter.binding(id)).toBe(binding)
      f.adapter.dispose()
      expect(f.release).toHaveBeenCalledOnce()
      expect(() => ref.binding).toThrow('disposed')
      expect(f.adapter.list.getSnapshot().ids).toEqual([])
    } finally { f.adapter.dispose(); await f.context.fiber.dispose() }
  })
  it('decodes create/fork inputs and callbacks, filters search, and rejects local filesystem paths', async () => {
    const f = fixture()
    try {
      const created = await f.adapter.create({ workspaceId: f.mapping.uiId('workspace', 'project') as WorkspaceId })
      expect(created).toBe(f.mapping.uiId('session', 'new'))
      expect(f.remote.create).toHaveBeenCalledWith({ workspaceId: 'project' })
      const callback = vi.fn()
      const fork = await f.adapter.fork({ sessionId: sid(f.mapping.uiId('session', 'same')), onCreated: callback })
      expect(callback).toHaveBeenCalledWith(f.mapping.uiId('session', 'fork'))
      expect(fork).toBe(f.mapping.uiId('session', 'fork'))
      expect(f.remote.fork).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'same' }))
      await expect(f.adapter.search('phrase', new AbortController().signal)).resolves.toEqual({ ok: true, value: { items: [{ sessionId: f.mapping.uiId('session', 'same'), snippet: 'same' }], hasMore: false } })
      await expect(f.adapter.create({ agentPreset: 'local' })).rejects.toThrow('local Agent preset')
      await expect(f.adapter.create({ cwd: 'C:\\Users\\local' })).rejects.toThrow('local path')
      expect(() => f.adapter.binding(sid('same'))).toThrow('mapped')
      expect(f.adapter.ownsSession(sid(new SingleWorkspaceMapping('old').uiId('session', 'same')))).toBe(true)
    } finally { f.adapter.dispose(); await f.context.fiber.dispose() }
  })
})
