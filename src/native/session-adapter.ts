/** Typed identity adapter between one isolated remote Session controller and native navigation. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  ISessions, SessionBinding, SessionFace, SessionListState, SessionReference,
  SessionRetainOptions, SessionTarget,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { SingleWorkspaceMapping, isMappedIdentity } from './mapping.ts'

/** Selected workspace membership and availability remain owned by the connector/catalog orchestrator. */
export interface NativeSessionAdapterOptions {
  readonly mapping: SingleWorkspaceMapping
  readonly remote: ISessions
  readonly getSessionIds: () => readonly string[]
  readonly online: () => boolean
}

/** Maps known identity fields only; generated RPC encoding continues through the original remote Context. */
export class NativeSessionAdapter implements ISessions {
  readonly list = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} })
  readonly searchResultLimit: number
  private closed = false
  private readonly created = new Set<string>()
  private readonly references = new Set<SessionReference>()
  private readonly bindings = new WeakMap<SessionBinding, SessionBinding>()
  private readonly unsubscribe: () => void

  /** @param options - isolated controller plus the selected workspace and current availability. */
  constructor(private readonly options: NativeSessionAdapterOptions) {
    this.searchResultLimit = options.remote.searchResultLimit
    this.unsubscribe = options.remote.list.subscribe(() => this.refreshCatalog())
    this.refreshCatalog()
  }

  /** Reserve the full remote family, including stale mappings, so none becomes a local request. */
  ownsSession = (id: SessionId): boolean => isMappedIdentity(id)
  /** Reserve the full remote family; decoding still validates entity kind and selected workspace. */
  ownsWorkspace = (id: WorkspaceId): boolean => isMappedIdentity(id)

  /** Reproject after membership changes; availability changes must also notify native UI separately. */
  refreshCatalog(): void {
    if (this.closed) return
    const source = this.options.remote.list.getSnapshot()
    const ids = source.ids.filter(id => this.allowed(id))
    const byId: SessionListState['byId'] = {}
    const projections: Record<string, SessionListState['projectionsBySession'][SessionId]> = {}
    for (const raw of ids) {
      const row = source.byId[raw]
      if (row === undefined) throw new Error('Remote Session catalog has no summary')
      const id = this.ui(raw)
      byId[id] = { ...row, id, ...(row.parentId === undefined ? {} : { parentId: this.ui(row.parentId) }) }
      const projection = source.projectionsBySession[raw]
      if (projection !== undefined) projections[id] = projection
    }
    this.list.set({ ids: ids.map(id => this.ui(id)), byId, phase: source.phase, projectionsBySession: projections })
  }

  retain(target: SessionTarget, options: SessionRetainOptions): SessionReference {
    this.assertOnline()
    const rawTarget: SessionTarget = typeof target === 'string' ? this.raw(target as SessionId) : {
      ...target, parentSessionId: this.raw(target.parentSessionId), childSessionId: this.raw(target.childSessionId),
    }
    const reference = this.options.remote.retain(rawTarget, options)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.references.delete(mapped)
      reference.release()
    }
    const adapter = this
    const mapped: SessionReference = {
      sessionId: this.ui(reference.sessionId),
      get binding() {
        adapter.assertOnline()
        if (released) throw new Error('Remote Session reference released')
        return adapter.projectBinding(reference.binding)
      },
      ready: reference.ready.then(binding => {
        adapter.assertOnline()
        if (released) throw new Error('Remote Session reference released')
        return adapter.projectBinding(binding)
      }),
      release, [Symbol.dispose]: release,
    }
    void mapped.ready.catch(() => {})
    this.references.add(mapped)
    return mapped
  }

  async using<T>(target: SessionTarget, options: SessionRetainOptions, operation: (reference: SessionReference) => T | Promise<T>): Promise<T> {
    const reference = this.retain(target, options)
    try { await reference.ready; return await operation(reference) } finally { reference.release() }
  }

  retainInfo(id: SessionId): ReturnType<ISessions['retainInfo']> { this.assertOnline(); return this.options.remote.retainInfo(this.raw(id)) }
  subagentAddress(id: SessionId): ReturnType<ISessions['subagentAddress']> {
    this.assertOnline()
    const address = this.options.remote.subagentAddress(this.raw(id))
    return address === undefined ? undefined : { ...address, parentSessionId: this.ui(address.parentSessionId), childSessionId: this.ui(address.childSessionId) }
  }
  refreshProjections(id: SessionId): Promise<void> { this.assertOnline(); return this.options.remote.refreshProjections(this.raw(id)) }
  async refresh(): Promise<void> { this.assertOnline(); await this.options.remote.refresh(); this.assertOnline(); this.refreshCatalog() }

  async search(...args: Parameters<ISessions['search']>): ReturnType<ISessions['search']> {
    this.assertOnline()
    const result = await this.options.remote.search(...args)
    this.assertOnline()
    if (!result.ok) return result
    return { ok: true, value: { ...result.value, items: result.value.items.filter(item => this.allowed(item.sessionId)).map(item => ({ ...item, sessionId: this.ui(item.sessionId) })) } }
  }

  async create(opts: Parameters<ISessions['create']>[0] = {}): ReturnType<ISessions['create']> {
    this.assertOnline()
    if (opts.cwd !== undefined) throw new Error('Remote Session creation requires workspace selection, not a local path')
    if (opts.agentPreset !== undefined) throw new Error('Remote Session creation cannot inherit a local Agent preset')
    if (opts.workspaceId !== undefined && this.options.mapping.remoteId('workspace', opts.workspaceId) !== this.options.mapping.workspaceId) throw new Error('Foreign remote workspace')
    const id = await this.options.remote.create({ ...opts, workspaceId: this.options.mapping.workspaceId as WorkspaceId,
      ...(opts.sessionId === undefined ? {} : { sessionId: this.raw(opts.sessionId) }) })
    this.assertOnline()
    this.created.add(id)
    this.refreshCatalog()
    return this.ui(id)
  }

  async fork(opts: Parameters<ISessions['fork']>[0]): ReturnType<ISessions['fork']> {
    this.assertOnline()
    const id = await this.options.remote.fork({ ...opts, sessionId: this.raw(opts.sessionId),
      ...(opts.onCreated === undefined ? {} : { onCreated: child => {
        this.assertOnline(); this.created.add(child); opts.onCreated?.(this.ui(child))
      } }),
    })
    this.assertOnline()
    this.created.add(id)
    this.refreshCatalog()
    return this.ui(id)
  }

  scope(id: SessionId): ReturnType<ISessions['scope']> { this.assertOnline(); return this.options.remote.scope(this.raw(id)) }
  binding(id: SessionId): ReturnType<ISessions['binding']> {
    this.assertOnline()
    const binding = this.options.remote.binding(this.raw(id))
    return binding === undefined ? undefined : this.projectBinding(binding)
  }
  scopeOf(ctx: Context): ReturnType<ISessions['scopeOf']> {
    if (this.closed || !this.options.online() || this.options.remote.sessionOf(ctx) === undefined) return undefined
    const id = this.options.remote.scopeOf(ctx)
    return id === undefined || !this.allowed(id) ? undefined : this.ui(id)
  }
  sessionOf(ctx: Context): ReturnType<ISessions['sessionOf']> {
    const id = this.scopeOf(ctx)
    return id === undefined ? undefined : this.binding(id)?.session
  }

  /** Release only Client references; the owner must separately dispose the isolated runtime. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    for (const reference of [...this.references]) reference.release()
    this.created.clear()
    this.list.set({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  }

  private ui(id: string): SessionId { return this.options.mapping.uiId('session', id) as SessionId }
  private raw(id: SessionId): SessionId {
    const raw = this.options.mapping.remoteId('session', id) as SessionId
    if (!this.allowed(raw)) throw new Error('Session is outside the selected remote workspace')
    return raw
  }
  private allowed(id: string, visited = new Set<string>()): boolean {
    if (this.created.has(id) || this.options.getSessionIds().includes(id)) return true
    if (visited.has(id)) return false
    visited.add(id)
    const address = this.options.remote.subagentAddress(id as SessionId)
    return address !== undefined && address.childSessionId === id && this.allowed(address.parentSessionId, visited)
  }
  private assertOnline(): void {
    if (this.closed) throw new Error('Remote Session adapter disposed')
    if (!this.options.online()) throw new Error('Remote workspace offline')
  }

  private projectBinding(raw: SessionBinding): SessionBinding {
    let binding = this.bindings.get(raw)
    if (binding !== undefined) return binding
    const session = raw.session
    let lastRaw: ReturnType<SessionFace['getSnapshot']> | undefined
    let lastMapped: ReturnType<SessionFace['getSnapshot']>
    const mapped: SessionFace = {
      sessionId: this.ui(raw.sessionId), projections: session.projections,
      getSnapshot: () => {
        const snapshot = session.getSnapshot()
        if (snapshot !== lastRaw) {
          lastRaw = snapshot
          lastMapped = { ...snapshot, sessionId: this.ui(snapshot.sessionId), subagent: snapshot.subagent === null ? null : {
            address: { ...snapshot.subagent.address, parentSessionId: this.ui(snapshot.subagent.address.parentSessionId), childSessionId: this.ui(snapshot.subagent.address.childSessionId) },
          } }
        }
        return lastMapped
      },
      subscribe: listener => session.subscribe(listener),
      beginSubmission: (...args) => { this.assertOnline(); return session.beginSubmission(...args) },
      prompt: (...args) => { this.assertOnline(); return session.prompt(...args) },
      readAttachment: (...args) => { this.assertOnline(); return session.readAttachment(...args) },
      updateQueue: (...args) => { this.assertOnline(); return session.updateQueue(...args) },
      cancel: () => { this.assertOnline(); return session.cancel() },
      rename: (...args) => { this.assertOnline(); return session.rename(...args) },
      loadOlder: (...args) => { this.assertOnline(); return session.loadOlder(...args) },
      consumeOlder: () => { this.assertOnline(); return session.consumeOlder() },
      loadThrough: (...args) => { this.assertOnline(); return session.loadThrough(...args) },
      command: (...args) => { this.assertOnline(); return session.command(...args) },
    }
    binding = { ...raw, source: { sessionId: raw.sessionId, ctx: raw.ctx }, sessionId: this.ui(raw.sessionId), session: mapped }
    this.bindings.set(raw, binding)
    return binding
  }
}
