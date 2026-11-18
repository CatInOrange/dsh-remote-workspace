import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SingleWorkspaceMapping } from './mapping.ts'

/** Native Workspace projection for exactly one selected remote workspace. */
export class MappedWorkspaceAdapter implements IWorkspaces {
  readonly list = { getSnapshot: (): WorkspaceSnapshot => this.getSnapshot(), subscribe: (listener: () => void): (() => void) => {
    this.assertOpen()
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  } }
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private snapshot: WorkspaceSnapshot | undefined
  private cachedRemote: WorkspaceSnapshot
  private online = false
  private closed = false

  /** @param remote - Independent remote native Controller. @param mapping - Selected workspace identity translator. */
  constructor(private readonly remote: IWorkspaces, readonly mapping: SingleWorkspaceMapping) {
    this.cachedRemote = remote.list.getSnapshot()
    this.unsubscribe = remote.list.subscribe(() => {
      if (!this.online) return
      this.cachedRemote = remote.list.getSnapshot()
      this.invalidate()
    })
  }

  /** @param online - Whether the source's authenticated carrier is available. */
  setOnline(online: boolean): void {
    this.assertOpen()
    if (this.online === online) return
    if (online) this.cachedRemote = this.remote.list.getSnapshot()
    this.online = online
    this.invalidate()
  }

  /** Dispose only local observation; never deletes a workspace or stops server work. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.online = false
    this.unsubscribe()
    this.listeners.clear()
    this.snapshot = undefined
  }

  /** Creating arbitrary remote workspaces is outside single-workspace mapping. */
  async create(_input: { path: string }): Promise<WorkspaceView> { throw new Error('Mapped workspace creation is unsupported') }
  /** Mapping never initializes a remote default workspace. */
  async initializeDefault(_signal?: AbortSignal): Promise<WorkspaceView | undefined> { throw new Error('Mapped default workspace initialization is unsupported') }
  /** Unmapping is local and must never delete the authoritative remote registration. */
  async delete(_workspaceId: WorkspaceId): Promise<void> { throw new Error('Unmap the workspace instead of deleting its remote registration') }

  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const raw = this.workspace(workspaceId)
    const result = await this.remote.rename(raw, title)
    this.assertOnline()
    return this.project(result)
  }

  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    this.workspace(workspaceId)
    if (beforeWorkspaceId !== undefined) this.workspace(beforeWorkspaceId)
    // The adapter exposes one row; there is no remote registry order to change.
  }

  async archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void> {
    const raw = this.session(sessionId)
    await this.remote.archiveSession(raw, options)
    this.assertOnline()
  }
  async unarchiveSession(sessionId: SessionId): Promise<void> {
    const raw = this.session(sessionId)
    await this.remote.unarchiveSession(raw)
    this.assertOnline()
  }
  async pinSession(sessionId: SessionId): Promise<void> {
    const raw = this.session(sessionId)
    await this.remote.pinSession(raw)
    this.assertOnline()
  }
  async unpinSession(sessionId: SessionId): Promise<void> {
    const raw = this.session(sessionId)
    await this.remote.unpinSession(raw)
    this.assertOnline()
  }
  async insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView> {
    const rawWorkspace = this.workspace(workspaceId)
    const rawSession = this.session(sessionId)
    const rawBefore = beforeSessionId === undefined ? undefined : this.session(beforeSessionId)
    const result = await this.remote.insertSessionBefore(rawWorkspace, rawSession, rawBefore)
    this.assertOnline()
    return this.project(result)
  }

  private getSnapshot(): WorkspaceSnapshot {
    this.assertOpen()
    if (this.snapshot !== undefined) return this.snapshot
    const source = this.cachedRemote
    const selected = this.selected(source)
    const membership = new Set(selected?.sessionIds ?? [])
    const mapSessions = (ids: readonly SessionId[]): SessionId[] => ids.filter(id => membership.has(id)).map(id => this.uiSession(id))
    this.snapshot = {
      ...source,
      items: selected === undefined ? [] : [this.project(selected)],
      archivedSessionIds: mapSessions(source.archivedSessionIds),
      pinnedSessionIds: mapSessions(source.pinnedSessionIds),
      // Offline is a carrier condition, not a fabricated Host business error.
      state: this.online ? source.state : 'loading',
    }
    return this.snapshot
  }

  private selected(snapshot: WorkspaceSnapshot): WorkspaceView | undefined {
    const selected = snapshot.items.filter(row => row.workspaceId === this.mapping.workspaceId)
    if (selected.length > 1) throw new Error('Duplicate selected remote workspace')
    return selected[0]
  }

  private project(row: WorkspaceView): WorkspaceView {
    if (row.workspaceId !== this.mapping.workspaceId) throw new Error('Remote command returned an unselected workspace')
    return { ...row, workspaceId: this.mapping.uiId('workspace', row.workspaceId) as WorkspaceId, sessionIds: row.sessionIds.map(id => this.uiSession(id)) }
  }
  private uiSession(id: SessionId): SessionId { return this.mapping.uiId('session', id) as SessionId }
  private workspace(id: WorkspaceId): WorkspaceId {
    this.assertOnline()
    const raw = this.mapping.remoteId('workspace', id)
    if (raw !== this.mapping.workspaceId || this.selected(this.remote.list.getSnapshot()) === undefined) throw new Error('Workspace is not selected or no longer available')
    return raw as WorkspaceId
  }
  private session(id: SessionId): SessionId {
    this.assertOnline()
    const raw = this.mapping.remoteId('session', id)
    const selected = this.selected(this.remote.list.getSnapshot())
    if (selected === undefined || !selected.sessionIds.some(member => member === raw)) throw new Error('Session is not a member of the selected workspace')
    return raw as SessionId
  }
  private assertOpen(): void { if (this.closed) throw new Error('Mapped workspace adapter disposed') }
  private assertOnline(): void {
    this.assertOpen()
    if (!this.online) throw new Error('Mapped workspace is offline')
  }
  private invalidate(): void {
    this.snapshot = undefined
    for (const listener of [...this.listeners]) listener()
  }
}
