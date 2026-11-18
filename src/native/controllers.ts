import { mountClientAccess, type ClientRemoteAccess } from '@deepseek-ai/dsh-api-remote-access/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { Context } from '@deepseek-ai/cordis'
import type { FileUploadService } from '@deepseek-ai/dsh-client-file-upload/client'
import * as sessions from '@deepseek-ai/dsh-api-session-controller/client'
import * as workspaces from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { NativeWorkspaceRuntime } from './runtime.ts'

/** Controllers bound to the remote runtime, still using original Host identities. */
export interface NativeControllers {
  readonly remote: ClientRemote
  readonly access?: ClientRemoteAccess
  readonly ctx: Context
  readonly sessions: sessions.ISessions
  readonly workspaces: workspaces.IWorkspaces
  dispose(): Promise<void>
}

/**
 * Mount native controllers under the independent runtime, never under the local page.
 * The caller must supply remote-addressed uploads explicitly: the stock browser
 * uploader can otherwise post Blob bodies to the Windows page's local Host.
 * Generated contributions must already be mounted. UI identity adapters belong
 * above these controllers; their raw IDs must not be published in the local tree.
 * @param runtime - authenticated independent Remote owner.
 * @param fileUpload - source-specific upload carrier, or an explicitly refusing implementation.
 * @returns independently disposable controllers; disposal does not stop Linux work.
 */
export async function createNativeControllers(
  runtime: NativeWorkspaceRuntime,
  fileUpload: FileUploadService,
  accessContribution?: TypertRemoteContribution,
): Promise<NativeControllers> {
  const ctx = runtime.ctx
  for (const namespace of ['session', 'commands', 'subagents', 'workspace']) {
    if (ctx.get(`remote.${namespace}`) === undefined) {
      throw new Error(`Missing generated remote capability: ${namespace}`)
    }
  }
  if (ctx.get('sessions') !== undefined || ctx.get('workspaces') !== undefined) {
    throw new Error('Remote controllers are already installed')
  }
  const owner = ctx.plugin({
    name: 'remote-workspace.controllers',
    inject: ['remote'],
    apply: async (child: Context) => {
      child.provide('fileUpload', fileUpload)
      if (accessContribution !== undefined) {
        const disposeAccess = await mountClientAccess(child, accessContribution, undefined, { publishRoot: false })
        child.effect(() => disposeAccess, 'remote-workspace.access')
      }
      await child.plugin(sessions)
      await child.plugin(workspaces)
    },
  })
  try {
    await owner
    return {
      ctx: owner.ctx,
      remote: runtime.remote,
      ...(accessContribution === undefined ? {} : { access: owner.ctx.get('remoteAccess') as ClientRemoteAccess }),
      sessions: owner.ctx.get('sessions') as sessions.ISessions,
      workspaces: owner.ctx.get('workspaces') as workspaces.IWorkspaces,
      dispose: async () => { await owner.dispose() },
    }
  } catch (error) {
    await owner.dispose()
    throw error
  }
}
