/** Narrow, credential-free renderer carrier for a main-owned remote connection. */
export interface NativeRemoteRequest {
  readonly id: string
  readonly path: string
  readonly method: 'GET' | 'POST'
  readonly body?: Uint8Array
  readonly contentType?: string
}
export interface NativeRemoteResponse {
  readonly status: number
  readonly contentType: string | null
  readonly body: Uint8Array
}
export type NativeRemoteEvent = { readonly id: string; readonly type: 'open' | 'close' | 'error' }
  | { readonly id: string; readonly type: 'message'; readonly data: string }
export interface NativeRemoteBridge {
  connect(address: string, token: string): Promise<{ readonly lease: string; readonly address: string }>
  release(lease: string): Promise<void>
  request(lease: string, request: NativeRemoteRequest): Promise<NativeRemoteResponse>
  cancel(lease: string, id: string): Promise<void>
  open(lease: string, id: string): Promise<void>
  send(lease: string, id: string, data: string): Promise<void>
  close(lease: string, id: string): Promise<void>
  subscribe(listener: (event: NativeRemoteEvent) => void): () => void
}
