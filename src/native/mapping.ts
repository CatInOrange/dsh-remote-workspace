/** Client-only identities for one selected remote workspace; never send these IDs to a Host. */
const prefix = 'dsh-remote-workspace:v1:'

type EntityKind = 'workspace' | 'session'

/** Minimal remote workspace fields needed to project its original sidebar row. */
export interface RemoteWorkspaceRow {
  readonly id: string
  readonly sessionIds: readonly string[]
}

/** One mapping owns UI identity translation and selection of its workspace row, not server authorization. */
export class SingleWorkspaceMapping {
  constructor(readonly workspaceId: string) {
    if (!workspaceId) throw new Error('A remote workspace must be selected')
  }

  /** Create a UI-only identity isolated from raw Host UUIDs and other mappings. */
  uiId(kind: EntityKind, remoteId: string): string {
    if (!remoteId) throw new Error('Remote identity must not be empty')
    return prefix + JSON.stringify([this.workspaceId, kind, remoteId])
  }

  /** Resolve only this mapping; malformed or stale remote identities never become local calls. */
  remoteId(kind: EntityKind, uiId: string): string {
    if (!uiId.startsWith(prefix)) throw new Error('Not a mapped remote identity')
    const value: unknown = JSON.parse(uiId.slice(prefix.length))
    if (!Array.isArray(value) || value.length !== 3 || value[0] !== this.workspaceId
      || value[1] !== kind || typeof value[2] !== 'string' || !value[2]
      || this.uiId(kind, value[2]) !== uiId) {
      throw new Error('Unknown or stale remote identity')
    }
    return value[2]
  }

  /** Return exactly the selected workspace with translated memberships, without mutating remote state. */
  projectWorkspace<T extends RemoteWorkspaceRow>(rows: readonly T[]): (Omit<T, 'id' | 'sessionIds'> & RemoteWorkspaceRow) | undefined {
    const selected = rows.filter(row => row.id === this.workspaceId)
    if (selected.length > 1) throw new Error('Duplicate remote workspace identity')
    const row = selected[0]
    if (!row) return undefined
    return { ...row, id: this.uiId('workspace', row.id), sessionIds: row.sessionIds.map(id => this.uiId('session', id)) }
  }
}

/** Recognize the reserved remote ID family even when its mapping is no longer available. */
export function isMappedIdentity(id: string): boolean {
  return id.startsWith(prefix)
}
