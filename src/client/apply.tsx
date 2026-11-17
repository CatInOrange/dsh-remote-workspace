import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopBrowserBridge } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { Panel, type PanelInjected } from './Panel.tsx'
import { en, zh } from './locales.ts'
import { remoteTarget } from './connection.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { remoteWorkspace: keyof typeof en }
}

/** Existing slot and locale services; no local execution service is involved. */
export const inject = ['slots', 'locale', 'layout']

/** Install an isolated remote workspace panel beside the existing local workspaces. */
export function apply(ctx: Context): void {
  const namespace = 'remoteWorkspace'
  const panel = 'remote.workspace' as MainPanelId
  const t = ctx.locale.bind(namespace)
  const carrier = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion: number; browser?: DesktopBrowserBridge } }).dshDesktop
  const bridge = carrier?.protocolVersion === 1 ? carrier.browser : undefined
  const storage = 'remote.workspace.address'
  const actions: PanelInjected = {
    bridge,
    readAddress: () => {
      const saved = localStorage.getItem(storage)
      if (saved === null) return ''
      try { return remoteTarget(saved, '').address }
      catch (error) { localStorage.removeItem(storage); return '' }
    },
    saveAddress: address => { localStorage.setItem(storage, remoteTarget(address, '').address) },
  }
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'remote-workspace: copy')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: namespace, inject: () => actions }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 15, label: () => t('title') },
    ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h1M7 16.5h1"/></svg>))
}
