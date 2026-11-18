import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemoteAccess } from '@deepseek-ai/dsh-api-remote-access/client'
import type { Context } from '@deepseek-ai/cordis'
import { registerWorkspaceSource } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { NativeControllers } from './controllers.ts'
import { SingleWorkspaceMapping } from './mapping.ts'
import { NativeSessionAdapter } from './session-adapter.ts'
import { MappedWorkspaceAdapter } from './workspace-adapter.ts'

/** One Client-side mapping lifetime. Does not own credentials or stop server work. */
export interface NativeSource {
  readonly sessions: NativeSessionAdapter
  readonly workspaces: MappedWorkspaceAdapter
  setOnline(online: boolean): void
  dispose(): Promise<void>
}

/** Register both projections under one child fiber; roll back partial registration on failure. */
export async function registerNativeSource(
  ctx: Context,
  controllers: NativeControllers,
  workspaceId: string,
  key: string,
  access?: ClientRemoteAccess,
  remote?: ClientRemote,
): Promise<NativeSource> {
  const localSessions = ctx.get('sessions') as import('@deepseek-ai/dsh-api-session-controller/client').ISessions
  if (ctx.get('workspaces') === undefined) throw new Error('Native Workspace controller is unavailable')
  const registerSessions = localSessions?.registerSource
  if (registerSessions === undefined) throw new Error('Native Session source registration is unavailable; patched client required')
  const localAccess = ctx.get('remoteAccess') as ClientRemoteAccess | undefined
  if (access !== undefined && localAccess?.registerSource === undefined) throw new Error('Native resource access registration is unavailable; patched client required')
  const localRemote = ctx.get('remote') as ClientRemote | undefined
  if (remote !== undefined && localRemote?.$attachEvents === undefined) throw new Error('Native event source attachment is unavailable; patched client required')
  const availability = createSnapshotStore(false)
  const mapping = new SingleWorkspaceMapping(workspaceId)
  const workspaces = new MappedWorkspaceAdapter(controllers.workspaces, mapping)
  let online = false
  let closed = false
  const sessions = new NativeSessionAdapter({
    mapping, remote: controllers.sessions, online: () => online && !closed,
    getSessionIds: () => workspaces.list.getSnapshot().items.flatMap(row => row.sessionIds.map(id => mapping.remoteId('session', id))),
  })
  const unsubscribe = workspaces.list.subscribe(() => sessions.refreshCatalog())
  const owner = ctx.plugin({
    name: `remote-workspace.source.${key}`,
    inject: ['sessions', 'workspaces', ...(access === undefined ? [] : ['remoteAccess'])],
    apply(child: Context) {
      child.effect(() => () => {
        closed = true
        online = false
        availability.set(false)
        unsubscribe()
        sessions.dispose()
        workspaces.dispose()
      }, 'remote-workspace.adapters')
      if (remote !== undefined) localRemote!.$attachEvents!(child, remote, ['approval/request', 'user-questions/request'])
      if (access !== undefined) localAccess!.registerSource!(child, {
        key,
        owns: (kind, id) => (kind === 'session' || kind === 'workspace') && sessions.ownsSession(id as never),
        source: (kind, id, action) => {
          const raw = mapping.remoteId(kind as 'session' | 'workspace', id)
          const grant = access.source(kind, raw, action)
          return {
            getSnapshot: () => availability.getSnapshot() && grant.getSnapshot(),
            subscribe(listener) {
              const one = availability.subscribe(listener), two = grant.subscribe(listener)
              return () => { one(); two() }
            },
          }
        },
      })
      registerSessions.call(localSessions, child, { key, sessions, ownsSession: sessions.ownsSession, ownsWorkspace: sessions.ownsWorkspace })
      registerWorkspaceSource(child, { key, workspaces, ownsSession: sessions.ownsSession, ownsWorkspace: sessions.ownsWorkspace })
    },
  })
  try {
    await owner
    return {
      sessions, workspaces,
      setOnline(value) {
        if (closed) throw new Error('Native source disposed')
        online = value
        availability.set(value)
        workspaces.setOnline(value)
        sessions.refreshCatalog()
      },
      dispose: async () => { await owner.dispose() },
    }
  } catch (error) {
    await owner.dispose()
    throw error
  }
}
