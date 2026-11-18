import { isMappedIdentity, SingleWorkspaceMapping, type RemoteWorkspaceRow } from './mapping.ts'

/** Minimal native session summary; all additional fields are preserved. */
export interface CatalogSessionRow { readonly id: string }

/** View-only composition; histories and server records are never copied into local persistence. */
export interface NativeCatalogSnapshot<W extends RemoteWorkspaceRow, S extends CatalogSessionRow> {
  readonly workspaces: readonly W[]
  readonly sessions: readonly S[]
  readonly remoteState: 'unmapped' | 'loading' | 'online' | 'offline'
  readonly selectedWorkspaceId: string | undefined
}

/** A route is valid only for the catalog generation in which it was resolved. */
export type CatalogRoute = { readonly source: 'local' | 'remote'; readonly id: string }

/** Selection-owned destinations; a previous selection's delayed callbacks have no effect. */
export interface RemoteCatalogSink<W, S> {
  replace(workspaces: readonly W[], sessions: readonly S[]): void
  offline(): void
}

/** One original local catalog plus one selected remote workspace, without a transport or UI dependency. */
export class NativeWorkspaceCatalog<W extends RemoteWorkspaceRow, S extends CatalogSessionRow> {
  private localWorkspaces: readonly W[] = []
  private localSessions: readonly S[] = []
  private remoteWorkspaces: readonly W[] = []
  private remoteSessions: readonly S[] = []
  private mapping: SingleWorkspaceMapping | undefined
  private state: NativeCatalogSnapshot<W, S>['remoteState'] = 'unmapped'
  private generation = 0
  private closed = false
  private readonly listeners = new Set<() => void>()
  private snapshot: NativeCatalogSnapshot<W, S> = Object.freeze({ workspaces: Object.freeze([]), sessions: Object.freeze([]), remoteState: 'unmapped', selectedWorkspaceId: undefined })

  /** Stable until an accepted catalog change; suitable for the native observable adapter. */
  getSnapshot = (): NativeCatalogSnapshot<W, S> => this.snapshot

  /** Subscribe to committed catalog replacements; returns an idempotent remover. */
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) throw new Error('Catalog disposed')
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Replace local rows without changing remote selection, availability or membership. */
  replaceLocal(workspaces: readonly W[], sessions: readonly S[]): void {
    this.assertOpen()
    validateRows(workspaces)
    validateRows(sessions)
    if ([...workspaces, ...sessions].some(row => isMappedIdentity(row.id))) {
      throw new Error('Local identity uses the reserved remote identity family')
    }
    this.localWorkspaces = copyWorkspaces(workspaces)
    this.localSessions = copySessions(sessions)
    this.publish()
  }

  /** Select one workspace and retire earlier feed callbacks, even when selecting the same raw id again. */
  selectRemote(workspaceId: string): RemoteCatalogSink<W, S> {
    this.assertOpen()
    const mapping = new SingleWorkspaceMapping(workspaceId)
    const generation = ++this.generation
    this.mapping = mapping
    this.remoteWorkspaces = []
    this.remoteSessions = []
    this.state = 'loading'
    this.publish()
    const current = (): boolean => !this.closed && generation === this.generation
    return {
      replace: (workspaces, sessions) => {
        if (!current()) return
        validateRows(workspaces)
        validateRows(sessions)
        const selected = mapping.projectWorkspace(workspaces)
        const membership = new Set(workspaces.find(row => row.id === workspaceId)?.sessionIds ?? [])
        const summaries = sessions.filter(row => membership.has(row.id))
        // Only id and workspace membership are translated here. Any other identity-bearing
        // summary fields require an upstream adapter before this foundation reaches the UI.
        this.remoteWorkspaces = selected ? copyWorkspaces([selected as W]) : []
        this.remoteSessions = copySessions(summaries.map(row => ({ ...row, id: mapping.uiId('session', row.id) })))
        this.state = 'online'
        this.publish()
      },
      offline: () => {
        if (!current() || this.state === 'offline') return
        this.state = 'offline'
        this.publish()
      },
    }
  }

  /** Unmap locally without changing or cancelling any server session. */
  clearRemote(): void {
    this.assertOpen()
    ++this.generation
    this.mapping = undefined
    this.remoteWorkspaces = []
    this.remoteSessions = []
    this.state = 'unmapped'
    this.publish()
  }

  /** Resolve a currently listed workspace; unknown, unmapped or offline remote IDs fail closed. */
  routeWorkspace(id: string): CatalogRoute {
    return this.route('workspace', id, this.localWorkspaces, this.remoteWorkspaces)
  }

  /** Resolve a listed member of the selected workspace, never an arbitrary remote session. */
  routeSession(id: string): CatalogRoute {
    return this.route('session', id, this.localSessions, this.remoteSessions)
  }

  /** Drop remote catalog ownership and observers, without touching remote execution. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    ++this.generation
    this.mapping = undefined
    this.remoteWorkspaces = []
    this.remoteSessions = []
    this.state = 'unmapped'
    this.publish()
    this.listeners.clear()
  }

  private route(kind: 'workspace' | 'session', id: string, local: readonly { id: string }[], remote: readonly { id: string }[]): CatalogRoute {
    this.assertOpen()
    if (isMappedIdentity(id)) {
      if (!this.mapping || this.state !== 'online' || !remote.some(row => row.id === id)) {
        throw new Error('Remote identity is unavailable')
      }
      return { source: 'remote', id: this.mapping.remoteId(kind, id) }
    }
    if (!local.some(row => row.id === id)) throw new Error('Unknown local identity')
    return { source: 'local', id }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Catalog disposed')
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      workspaces: Object.freeze([...this.localWorkspaces, ...this.remoteWorkspaces]),
      sessions: Object.freeze([...this.localSessions, ...this.remoteSessions]),
      remoteState: this.state,
      selectedWorkspaceId: this.mapping?.workspaceId,
    })
    for (const listener of [...this.listeners]) {
      try { listener() }
      catch (error) { console.error('[remote-workspace] catalog observer failed', error) }
    }
  }
}

function validateRows(rows: readonly { readonly id: string }[]): void {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Empty or duplicate catalog identity')
    ids.add(row.id)
  }
}

function copyWorkspaces<W extends RemoteWorkspaceRow>(rows: readonly W[]): readonly W[] {
  return Object.freeze(rows.map(row => Object.freeze({ ...row, sessionIds: Object.freeze([...row.sessionIds]) })))
}

function copySessions<S extends CatalogSessionRow>(rows: readonly S[]): readonly S[] {
  return Object.freeze(rows.map(row => Object.freeze({ ...row })))
}
