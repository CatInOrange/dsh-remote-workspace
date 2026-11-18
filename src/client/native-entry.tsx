import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import questions from '@deepseek-ai/dsh-user-questions/remote'
import access from '@deepseek-ai/dsh-api-remote-access/remote'
import session from '@deepseek-ai/dsh-api-session-controller/remote'
import workspace from '@deepseek-ai/dsh-api-workspace-controller/remote'
import commands from '@deepseek-ai/dsh-commands/remote'
import subagents from '@deepseek-ai/dsh-subagent/remote'
import { NativeClientManager } from '../native/client-manager.ts'
import type { NativeRemoteBridge } from '../native/relay-protocol.ts'
import { NativePanel } from './NativePanel.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { remoteWorkspace: keyof typeof en }
}

export const inject = ['slots', 'locale', 'layout', 'sessions', 'workspaces', 'remoteAccess', 'remote']
/** Native replacement entry. Only configuration uses this panel, never remote chat HTML. */
export function apply(ctx: Context): void {
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion: number; nativeRemote?: NativeRemoteBridge } }).dshDesktop
  const bridge = carrier?.protocolVersion === 1 ? carrier.nativeRemote : undefined
  const manager = bridge === undefined ? undefined : new NativeClientManager(ctx, bridge, [session, workspace, commands, subagents, questions], access)
  ctx.effect(() => () => manager?.dispose(), 'native-remote: connection lifetime')
  const panel = 'remote.workspace' as MainPanelId
  const namespace = 'remoteWorkspace'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'native-remote: copy')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: namespace, inject: () => ({ manager }) }, NativePanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 15, label: () => '远程工作区' },
    ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/></svg>))
}
