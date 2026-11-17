// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { DesktopBrowserBridge, DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { RemoteGuest } from '../src/client/guest.ts'

function fixture() {
  const release = vi.fn(async () => {})
  const links = vi.fn()
  const bridge: DesktopBrowserBridge = {
    acquire: vi.fn(async () => ({ lease: 'lease' as DesktopBrowserLeaseId, partition: 'persist:isolated' })),
    release, onOpenRequested: () => links,
  }
  return { bridge, release, links, host: document.createElement('div') }
}

it('uses only main-issued partition and lease and preserves failures until a retry', async () => {
  const { bridge, host, release, links } = fixture()
  const states: string[] = []
  const guest = new RemoteGuest(bridge)
  await guest.mount(host, 'https://example.com', 'https://example.com/?token=test-token', state => states.push(state))
  const element = host.firstElementChild!
  const loadURL = vi.fn(async (_url: string) => {})
  Object.assign(element, { loadURL, reload: vi.fn() })
  expect(bridge.acquire).toHaveBeenCalledWith('remote.workspace:https://example.com', { persistent: true })
  expect(element.getAttribute('src')).toBe('about:blank#lease')
  expect(element.getAttribute('partition')).toBe('persist:isolated')
  expect(element.hasAttribute('preload')).toBe(false)
  element.dispatchEvent(new Event('dom-ready'))
  expect(loadURL).toHaveBeenCalledWith('https://example.com/?token=test-token')
  element.dispatchEvent(new Event('did-fail-load'))
  element.dispatchEvent(new Event('did-stop-loading'))
  expect(states.at(-1)).toBe('error')
  element.dispatchEvent(new Event('did-start-loading'))
  element.dispatchEvent(new Event('did-stop-loading'))
  expect(states.at(-1)).toBe('loaded')
  await guest.dispose()
  expect(host.childElementCount).toBe(0)
  expect(release).toHaveBeenCalledExactlyOnceWith('lease')
  expect(links).toHaveBeenCalledOnce()
})

it('releases a reservation arriving after panel disposal without attaching a guest', async () => {
  const { bridge, host, release } = fixture()
  let deliver!: (value: Awaited<ReturnType<DesktopBrowserBridge['acquire']>>) => void
  bridge.acquire = () => new Promise(resolve => { deliver = resolve })
  const guest = new RemoteGuest(bridge)
  const mounting = guest.mount(host, 'https://example.com', 'https://example.com/', vi.fn())
  const disposal = guest.dispose()
  deliver({ lease: 'late' as DesktopBrowserLeaseId, partition: 'partition' })
  await Promise.all([mounting, disposal])
  expect(host.childElementCount).toBe(0)
  expect(release).toHaveBeenCalledExactlyOnceWith('late')
})
