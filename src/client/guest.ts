import type { DesktopBrowserBridge, DesktopBrowserReservation } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'

/** Electron guest interface; remote pages have no local application preload. */
interface GuestElement extends HTMLElement { loadURL(url: string): Promise<void>; reload(): void }

/** Own one reservation and every DOM/event effect until disposal. */
export class RemoteGuest {
  private disposed = false
  private reservation: DesktopBrowserReservation | undefined
  private element: GuestElement | undefined
  private releaseLinks: (() => void) | undefined
  private pending: Promise<void> | undefined

  constructor(private readonly bridge: DesktopBrowserBridge) {}

  /** @param host - plugin-owned viewport. @param address - sanitized origin. @param login - temporary login URL. @param report - visible loading/failure callback. */
  mount(host: HTMLElement, address: string, login: string, report: (state: 'loading' | 'loaded' | 'error') => void): Promise<void> {
    if (this.pending !== undefined) throw new Error('remote guest already mounted')
    this.pending = this.start(host, address, login, report)
    return this.pending
  }

  private async start(host: HTMLElement, address: string, login: string, report: (state: 'loading' | 'loaded' | 'error') => void): Promise<void> {
    const reservation = await this.bridge.acquire(`remote.workspace:${address}`, { persistent: true })
    this.reservation = reservation
    if (this.disposed) return
    const element = document.createElement('webview') as GuestElement
    this.element = element
    element.style.cssText = 'display:flex;width:100%;height:100%;min-height:0;'
    element.setAttribute('partition', reservation.partition)
    element.setAttribute('allowpopups', '')
    element.setAttribute('src', `about:blank#${reservation.lease}`)
    element.setAttribute('aria-label', address)
    let bootstrapped = false
    let loadFailed = false
    element.addEventListener('dom-ready', () => {
      if (bootstrapped || this.disposed) return
      bootstrapped = true
      const initialUrl = login
      login = ''
      void element.loadURL(initialUrl).catch(() => { loadFailed = true; if (!this.disposed) report('error') })
    })
    element.addEventListener('did-start-loading', () => { if (bootstrapped && !this.disposed) { loadFailed = false; report('loading') } })
    element.addEventListener('did-stop-loading', () => { if (bootstrapped && !this.disposed && !loadFailed) report('loaded') })
    element.addEventListener('did-fail-load', () => { loadFailed = true; if (!this.disposed) report('error') })
    element.addEventListener('render-process-gone', () => { if (!this.disposed) report('error') })
    // Existing bridge denies native popups; approved same-origin links stay inside this guest.
    this.releaseLinks = this.bridge.onOpenRequested(reservation.lease, url => {
      if (new URL(url).origin === address && !this.disposed) void element.loadURL(url).catch(() => report('error'))
    })
    host.append(element)
  }

  /** Reload without retaining or replaying the access token. */
  reload(): void { this.element?.reload() }

  /** Settle a late reservation before releasing; cleanup never ends Linux tasks. */
  async dispose(): Promise<void> {
    this.disposed = true
    try { await this.pending } catch (error) { /* The mount caller owns its visible failure. */ }
    this.releaseLinks?.()
    this.element?.remove()
    if (this.reservation !== undefined) {
      const reservation = this.reservation
      this.reservation = undefined
      await this.bridge.release(reservation.lease)
    }
  }
}
