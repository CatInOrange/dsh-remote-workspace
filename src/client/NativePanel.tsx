import { useState, useSyncExternalStore } from 'react'
import type { NativeClientManager } from '../native/client-manager.ts'

export interface NativePanelProps { readonly manager?: NativeClientManager | undefined }
/** Connection configuration only; conversations remain in the original native view. */
export function NativePanel({ manager }: NativePanelProps) {
  const [address, setAddress] = useState(() => localStorage.getItem('remote.workspace.native.address') ?? '')
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState(() => localStorage.getItem('remote.workspace.native.selection') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (manager === undefined) return <section style={{ padding: 24 }}><h2>远程工作区</h2><p>需要包含原生远程连接接口的桌面客户端。旧版内嵌网页不能提供原生映射。</p></section>
  return <ConnectedPanel manager={manager} {...{ address, setAddress, token, setToken, selected, setSelected, error, setError, busy, setBusy }} />
}
function ConnectedPanel({ manager, address, setAddress, token, setToken, selected, setSelected, error, setError, busy, setBusy }: { manager: NativeClientManager } & {
  address: string; setAddress(value: string): void; token: string; setToken(value: string): void;
  selected: string; setSelected(value: string): void; error: string; setError(value: string): void;
  busy: boolean; setBusy(value: boolean): void;
}) {
  const state = useSyncExternalStore(manager.state.subscribe, manager.state.getSnapshot)
  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await operation() } catch (error) { setError(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  return <section style={{ padding: 24, maxWidth: 640 }}>
    <h2>远程工作区</h2>
    <p>保留本机工作区，只将选中的一个 Linux 工作区和会话加入原生列表。</p>
    {(state.phase === 'idle' || state.phase === 'error') && <form onSubmit={event => {
      event.preventDefault()
      const credential = token; setToken('')
      void act(async () => {
        await manager.connect(address, credential)
        if (manager.state.getSnapshot().phase !== 'error') localStorage.setItem('remote.workspace.native.address', new URL(address).origin)
      })
    }}>
      <label>服务器地址<input type="url" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://example.com" required disabled={busy} /></label>
      <label>访问令牌<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" required disabled={busy} /></label>
      <button type="submit" disabled={busy}>连接</button>
      <p>令牌不保存在浏览器；认证只在本次桌面连接中保留。</p>
    </form>}
    {state.phase === 'connecting' && <p role="status">正在连接…</p>}
    {state.phase === 'connected' && <>
      <label>选择一个工作区<select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
        <option value="">请选择</option>
        {state.workspaces.map(row => <option key={row.id} value={row.id}>{row.title || row.path}</option>)}
      </select></label>
      <button disabled={!selected || !state.online || busy} onClick={() => { void act(async () => { await manager.map(selected); localStorage.setItem('remote.workspace.native.selection', selected) }) }}>映射到原生列表</button>
    </>}
    {state.phase === 'mapped' && <p>已映射。请在原来的工作区列表中打开会话；对话不在此面板内嵌网页。</p>}
    {(state.phase === 'connected' || state.phase === 'mapped') && <>
      <p role="status">{state.online ? '已连接' : '连接中断，远程操作不可用'}</p>
      <button disabled={busy} onClick={() => { void act(() => manager.disconnect()) }}>断开连接</button>
    </>}
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
    <p>原生集成开发版：附件上传尚未启用，尚未完成 Windows 验收。撤销映射后再次映射暂需刷新页面。</p>
  </section>
}
