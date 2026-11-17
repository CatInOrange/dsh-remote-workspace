import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { remoteTarget, type RemoteTarget } from './connection.ts'
import { RemoteGuest } from './guest.ts'
import type { DesktopBrowserBridge } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import css from './Panel.module.css'

/** Narrow platform actions; no Host transport is exposed to the remote document. */
export interface PanelInjected { bridge: DesktopBrowserBridge | undefined; readAddress(): string; saveAddress(address: string): void }
type Props = PropsRuntime<'main'> & PropsLocale<'remoteWorkspace'> & PanelInjected

/** One remote panel; local workspaces remain owned by the original sidebar. */
export function Panel({ t, bridge, readAddress, saveAddress }: Props) {
  const [address, setAddress] = useState(readAddress)
  const [token, setToken] = useState('')
  const [target, setTarget] = useState<RemoteTarget | null>(() => {
    const saved = readAddress()
    return saved === '' ? null : remoteTarget(saved, '')
  })
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'invalid'>('loading')
  const [online, setOnline] = useState(navigator.onLine)
  const viewport = useRef<HTMLDivElement>(null)
  const guest = useRef<RemoteGuest | null>(null)
  const onlineState = useRef(online)
  useEffect(() => {
    const update = () => {
      const next = navigator.onLine
      if (next && !onlineState.current) guest.current?.reload()
      onlineState.current = next
      setOnline(next)
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (target === null || bridge === undefined || viewport.current === null) return
    const current = new RemoteGuest(bridge)
    guest.current = current
    let active = true
    setStatus('loading')
    void current.mount(viewport.current, target.address, target.login, state => { if (active) setStatus(state) })
      .catch(() => { if (active) setStatus('error') })
    return () => {
      active = false
      guest.current = null
      void current.dispose().catch(error => { console.error('Remote workspace cleanup failed', error) })
    }
  }, [bridge, target])
  const connect = (event: React.FormEvent) => {
    event.preventDefault()
    let next: RemoteTarget
    try { next = remoteTarget(address, token) }
    catch (error) { setStatus('invalid'); return }
    try { saveAddress(next.address) }
    catch (error) { setStatus('error'); return }
    setAddress(next.address)
    setToken('')
    setTarget(next)
  }
  return <section className={css.panel}>
    <header className={css.header}>
      <h2>{t('title')}</h2>
      <form className={css.form} onSubmit={connect}>
        <label>{t('address')}<Input value={address} onChange={event => setAddress(event.target.value)} spellCheck={false} placeholder="https://example.com" autoComplete="off" /></label>
        <label>{t('token')}<Input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></label>
        <Button size="sm" variant="outline" type="submit" disabled={bridge === undefined}>{t('connect')}</Button>
        {target !== null && <Button size="sm" variant="outline" type="button" onClick={() => guest.current?.reload()}>{t('retry')}</Button>}
        {target !== null && <Button size="sm" variant="outline" type="button" onClick={() => { setTarget(null); setToken('') }}>{t('disconnect')}</Button>}
      </form>
      <p>{t('auth')}</p>
      <p>{t('note')}</p>
      <div role="status" aria-live="polite" className={css.status}>
        {bridge === undefined ? t('unsupported') : !online ? t('offline') : status === 'error' ? t('error') : status === 'invalid' ? t('invalid') : target !== null && status === 'loading' ? t('loading') : ''}
      </div>
    </header>
    <div className={css.viewport} ref={viewport} />
  </section>
}
