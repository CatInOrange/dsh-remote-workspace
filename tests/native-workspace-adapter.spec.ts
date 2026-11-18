import { describe, expect, it, vi } from 'vitest'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MappedWorkspaceAdapter } from '../src/native/workspace-adapter.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'
const wid = (id: string): WorkspaceId => id as WorkspaceId
const sid = (id: string): SessionId => id as SessionId
const row = (id: string, sessions = ['s']): WorkspaceView => ({ workspaceId: wid(id), path: '/linux/'+id, title: id, sessionIds: sessions.map(sid), createdAt: '', updatedAt: '' })
function fixture() {
  const listeners = new Set<() => void>()
  let snapshot: WorkspaceSnapshot = { items: [row('chosen'), row('other', ['foreign'])], archivedSessionIds: [sid('s'), sid('foreign')], pinnedSessionIds: [sid('foreign'), sid('s')], state: 'idle', phase: 'ready', error: null }
  const remote: IWorkspaces = {
    list: { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    create: vi.fn(async () => row('new')), initializeDefault: vi.fn(async () => row('default')),
    rename: vi.fn(async (_id, title) => ({ ...row('chosen'), title })), delete: vi.fn(async () => {}), insertBefore: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}), unarchiveSession: vi.fn(async () => {}), pinSession: vi.fn(async () => {}), unpinSession: vi.fn(async () => {}),
    insertSessionBefore: vi.fn(async () => row('chosen')),
  }
  const mapping = new SingleWorkspaceMapping('chosen')
  const adapter = new MappedWorkspaceAdapter(remote, mapping)
  const workspace = wid(mapping.uiId('workspace', 'chosen')), session = sid(mapping.uiId('session', 's'))
  return { remote, mapping, adapter, workspace, session, listeners, update(next: WorkspaceSnapshot) { snapshot = next; for (const listener of [...listeners]) listener() } }
}
describe('single mapped native Workspace adapter', () => {
  it('projects exactly one Workspace and every typed membership/archive/pin identity', () => {
    const f = fixture()
    f.adapter.setOnline(true)
    const snapshot = f.adapter.list.getSnapshot()
    expect(snapshot.items).toEqual([{ ...row('chosen'), workspaceId: f.workspace, sessionIds: [f.session] }])
    expect(snapshot.archivedSessionIds).toEqual([f.session])
    expect(snapshot.pinnedSessionIds).toEqual([f.session])
    expect(f.adapter.list.getSnapshot()).toBe(snapshot)
    f.adapter.dispose()
    expect(f.listeners.size).toBe(0)
  })
  it('translates command arguments and returned Workspace rows without leaking mapped IDs', async () => {
    const f = fixture(); f.adapter.setOnline(true)
    await expect(f.adapter.rename(f.workspace, 'Renamed')).resolves.toMatchObject({ workspaceId: f.workspace, sessionIds: [f.session], title: 'Renamed' })
    expect(f.remote.rename).toHaveBeenCalledWith('chosen', 'Renamed')
    await f.adapter.archiveSession(f.session, { stopActivity: true })
    await f.adapter.unarchiveSession(f.session)
    await f.adapter.pinSession(f.session)
    await f.adapter.unpinSession(f.session)
    expect(f.remote.archiveSession).toHaveBeenCalledWith('s', { stopActivity: true })
    expect(f.remote.unarchiveSession).toHaveBeenCalledWith('s')
    expect(f.remote.pinSession).toHaveBeenCalledWith('s')
    expect(f.remote.unpinSession).toHaveBeenCalledWith('s')
    await expect(f.adapter.insertSessionBefore(f.workspace, f.session, f.session)).resolves.toMatchObject({ workspaceId: f.workspace })
    expect(f.remote.insertSessionBefore).toHaveBeenCalledWith('chosen', 's', 's')
  })
  it('retains the latest rows offline and refuses commands and disposed use', async () => {
    const f = fixture(); f.adapter.setOnline(true)
    const snapshot = f.adapter.list.getSnapshot()
    f.adapter.setOnline(false)
    f.update({ ...snapshot, items: [] })
    expect(f.adapter.list.getSnapshot().items[0]?.workspaceId).toBe(f.workspace)
    expect(f.adapter.list.getSnapshot().state).toBe('loading')
    await expect(f.adapter.pinSession(f.session)).rejects.toThrow('offline')
    await expect(f.adapter.rename(f.workspace, 'no')).rejects.toThrow('offline')
    expect(f.remote.pinSession).not.toHaveBeenCalled()
    f.adapter.dispose()
    await expect(f.adapter.rename(f.workspace, 'no')).rejects.toThrow('disposed')
  })
  it('rejects unselected, stale and unsupported operations before remote dispatch', async () => {
    const f = fixture(); f.adapter.setOnline(true)
    const foreign = sid(f.mapping.uiId('session', 'foreign'))
    await expect(f.adapter.pinSession(foreign)).rejects.toThrow('not a member')
    await expect(f.adapter.rename(wid(f.mapping.uiId('workspace', 'other')), 'x')).rejects.toThrow('not selected')
    await expect(f.adapter.rename(wid(new SingleWorkspaceMapping('old').uiId('workspace', 'chosen')), 'x')).rejects.toThrow('stale')
    await expect(f.adapter.insertBefore(f.workspace, wid('local'))).rejects.toThrow('Not a mapped')
    await expect(f.adapter.create({ path: '/new' })).rejects.toThrow('unsupported')
    await expect(f.adapter.initializeDefault()).rejects.toThrow('unsupported')
    await expect(f.adapter.delete(f.workspace)).rejects.toThrow('Unmap')
    expect(f.remote.create).not.toHaveBeenCalled()
    expect(f.remote.initializeDefault).not.toHaveBeenCalled()
    expect(f.remote.delete).not.toHaveBeenCalled()
    expect(f.remote.rename).not.toHaveBeenCalled()
  })
  it('refuses foreign command output and a response arriving after source went offline', async () => {
    const f = fixture(); f.adapter.setOnline(true)
    vi.mocked(f.remote.rename).mockResolvedValueOnce(row('other'))
    await expect(f.adapter.rename(f.workspace, 'x')).rejects.toThrow('unselected')
    vi.mocked(f.remote.rename).mockImplementationOnce(async () => { f.adapter.setOnline(false); return row('chosen') })
    await expect(f.adapter.rename(f.workspace, 'x')).rejects.toThrow('offline')
  })
  it('publishes source updates and refuses membership removed after selection', async () => {
    const f = fixture(); f.adapter.setOnline(true)
    const changed = vi.fn()
    f.adapter.list.subscribe(changed)
    const before = f.adapter.list.getSnapshot()
    f.update({ ...before, items: [row('chosen', [])], archivedSessionIds: [sid('s')], pinnedSessionIds: [sid('s')] })
    expect(changed).toHaveBeenCalledOnce()
    expect(f.adapter.list.getSnapshot()).toMatchObject({ archivedSessionIds: [], pinnedSessionIds: [] })
    await expect(f.adapter.pinSession(f.session)).rejects.toThrow('not a member')
    f.update({ ...before, items: [] })
    expect(f.adapter.list.getSnapshot().items).toEqual([])
    await expect(f.adapter.rename(f.workspace, 'gone')).rejects.toThrow('no longer available')
  })

})
