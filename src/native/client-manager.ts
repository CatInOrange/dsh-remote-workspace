import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { FileUploadService } from '@deepseek-ai/dsh-client-file-upload/client'
import { createNativeRelay } from './relay.ts'
import type { NativeRemoteBridge } from './relay-protocol.ts'
import { createNativeWorkspaceRuntime, type NativeWorkspaceRuntime } from './runtime.ts'
import { createNativeControllers, type NativeControllers } from './controllers.ts'
import { registerNativeSource, type NativeSource } from './source.ts'

export interface NativeClientState {
  readonly phase: 'idle' | 'connecting' | 'connected' | 'mapped' | 'error'
  readonly online: boolean
  readonly workspaces: readonly { readonly id: string; readonly title: string; readonly path: string }[]
  readonly selected?: string
  readonly error?: string
}
/** Own one authenticated lease, isolated runtime, and exactly one native sidebar mapping. */
export class NativeClientManager {
  readonly state = createSnapshotStore<NativeClientState>({ phase: 'idle', online: false, workspaces: [] })
  private lease: string | undefined
  private runtime: NativeWorkspaceRuntime | undefined
  private controllers: NativeControllers | undefined
  private source: NativeSource | undefined
  private readonly subscriptions: (() => void)[] = []
  private closed = false
  private generation = 0
  // The current source registry reserves retired identity families for the page lifetime.
  private mapped = false

  constructor(private readonly ctx: Context, private readonly bridge: NativeRemoteBridge,
    private readonly contributions: readonly TypertRemoteContribution[],
    private readonly accessContribution?: TypertRemoteContribution) {}

  async connect(address: string, token: string): Promise<void> {
    if (this.closed || this.mapped || this.state.getSnapshot().phase === 'connecting' || this.lease !== undefined) throw new Error('Disconnect before connecting; remapping currently requires a page reload')
    const generation = ++this.generation
    this.state.set({ phase: 'connecting', online: false, workspaces: [] })
    try {
      const lease = await this.bridge.connect(address, token)
      if (generation !== this.generation || this.closed) { await this.bridge.release(lease.lease); return }
      this.lease = lease.lease
      const runtime = await createNativeWorkspaceRuntime(createNativeRelay(this.bridge, lease), this.contributions)
      if (generation !== this.generation || this.closed) { await runtime.dispose(); return }
      this.runtime = runtime
      const unsupported = async (): Promise<never> => { throw new Error('Remote attachment upload is not enabled') }
      const fileUpload: FileUploadService = { upload: unsupported, uploadImage: unsupported }
      const controllers = await createNativeControllers(runtime, fileUpload, this.accessContribution)
      if (generation !== this.generation || this.closed) { await controllers.dispose(); return }
      this.controllers = controllers
      const update = (): void => {
        const online = runtime.connection.generation.getSnapshot() !== undefined
        const snapshot = controllers.workspaces.list.getSnapshot()
        this.source?.setOnline(online)
        this.state.set({ ...this.state.getSnapshot(), phase: this.source === undefined ? 'connected' : 'mapped', online,
          workspaces: snapshot.items.map(row => ({ id: row.workspaceId, title: row.title, path: row.path })),
        })
      }
      this.subscriptions.push(runtime.connection.generation.subscribe(update), controllers.workspaces.list.subscribe(update))
      update()
    } catch (error) {
      if (generation !== this.generation || this.closed) return
      await this.disconnect()
      this.state.set({ phase: 'error', online: false, workspaces: [], error: error instanceof Error ? error.message : 'Remote connection failed' })
    }
  }

  async map(workspaceId: string): Promise<void> {
    if (this.closed || this.mapped || this.controllers === undefined || !this.state.getSnapshot().online) throw new Error('Remote mapping is unavailable')
    if (!this.state.getSnapshot().workspaces.some(row => row.id === workspaceId)) throw new Error('Select an existing remote workspace')
    this.mapped = true
    const generation = this.generation
    const source = await registerNativeSource(this.ctx, this.controllers, workspaceId, `native-remote-${generation}`, this.controllers.access, this.controllers.remote)
    if (generation !== this.generation || this.closed) { await source.dispose(); return }
    this.source = source
    this.source.setOnline(this.runtime!.connection.generation.getSnapshot() !== undefined)
    this.state.set({ ...this.state.getSnapshot(), phase: 'mapped', selected: workspaceId })
  }

  async disconnect(): Promise<void> {
    ++this.generation
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
    const source = this.source; this.source = undefined
    const controllers = this.controllers; this.controllers = undefined
    const runtime = this.runtime; this.runtime = undefined
    const lease = this.lease; this.lease = undefined
    try {
      try { await source?.dispose() }
      finally {
        try { await controllers?.dispose() }
        finally { try { await runtime?.dispose() } finally { if (lease !== undefined) await this.bridge.release(lease) } }
      }
    } finally { this.state.set({ phase: 'idle', online: false, workspaces: [] }) }
  }

  async dispose(): Promise<void> { if (this.closed) return; this.closed = true; await this.disconnect() }
}
