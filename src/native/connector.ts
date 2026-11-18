import { remoteTarget } from '../client/connection.ts'

/** Host-only injectable HTTP transport; never run this cookie owner in a browser panel. */
export type ConnectorFetch = (url: string, init: RequestInit) => Promise<Response>

/** Host socket factory supplies lifecycle ownership without exposing credentials to the UI. */
export interface ConnectorSocket<T> {
  readonly socket: T
  readonly closed: Promise<void>
  close(): void
}

/** One authenticated server connection. Credentials remain private and process-local. */
export class RemoteHostConnector {
  readonly address: string
  #cookie: string | undefined
  #lifetime = new AbortController()
  #login: AbortController | undefined
  #disposed = false
  #authenticationGeneration = 0
  #sockets = new Set<ConnectorSocket<unknown>>()

  constructor(address: string, private readonly send: ConnectorFetch = globalThis.fetch) {
    const target = remoteTarget(address, '')
    if (target.login !== target.address + '/') throw new Error('Supply credentials only to login')
    this.address = target.address
  }

  /** Exchange a native launch token without following redirects or retaining the token. */
  async login(token: string, signal?: AbortSignal): Promise<void> {
    this.assertLive()
    if (!token.trim()) throw new Error('A Harness access token is required')
    this.#login?.abort()
    const attempt = new AbortController()
    this.#login = attempt
    const requestSignal = AbortSignal.any([this.#lifetime.signal, attempt.signal, ...(signal ? [signal] : [])])
    const url = new URL(this.address)
    url.searchParams.set('token', token.trim())
    let response: Response
    try {
      response = await this.send(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: requestSignal })
    } catch {
      throw new Error('Remote authentication request failed')
    }
    try {
      requestSignal.throwIfAborted()
      if (response.status !== 303 || new URL(response.headers.get('location') ?? '', this.address).href !== this.address + '/') {
        throw new Error('Remote authentication was refused')
      }
      const cookies = response.headers.getSetCookie()
        .map(value => value.split(';', 1)[0]!)
        .filter(value => /^dsh-auth-[A-Za-z0-9_-]+=[A-Za-z0-9_.-]+$/.test(value))
      if (cookies.length !== 1) throw new Error('Remote authentication did not issue a supported cookie')
      this.#cookie = cookies[0]
      ++this.#authenticationGeneration
    } finally {
      await response.body?.cancel()
      if (this.#login === attempt) this.#login = undefined
    }
  }

  /** Send only native API requests to this server; redirects cannot forward its cookie elsewhere. */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    this.assertLive()
    if (!this.#cookie) throw new Error('Remote connection is not authenticated')
    // Match Connection's generated channel/endpoint routes, not arbitrary user URLs.
    if (!/^\/?api\/[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*(?:\/[A-Za-z0-9_$.-]+)*$/.test(path)
      || path.split('/').some(part => part === '.' || part === '..')) throw new Error('Unsupported remote API route')
    const url = new URL(path.replace(/^\//, ''), this.address + '/')
    const headers = new Headers(init.headers)
    headers.delete('authorization')
    headers.set('cookie', this.#cookie)
    const signal = AbortSignal.any([this.#lifetime.signal, ...(init.signal ? [init.signal] : [])])
    const generation = this.#authenticationGeneration
    let response: Response
    try {
      response = await this.send(url.href, { ...init, headers, credentials: 'omit', redirect: 'manual', signal })
    } catch {
      throw new Error('Remote API transport failed')
    }
    if (signal.aborted) {
      await response.body?.cancel()
      throw new Error('Remote API request was cancelled')
    }
    if (response.status === 401 && generation === this.#authenticationGeneration) this.#cookie = undefined
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('Remote API redirects are not supported')
    }
    return response
  }

  /** Open the native multiplexed stream socket using this Host's cookie and exact API path. */
  openWebSocket<T>(path: string, create: (url: string, cookie: string) => ConnectorSocket<T>): T {
    this.assertLive()
    if (!this.#cookie) throw new Error('Remote connection is not authenticated')
    if (path !== '/api/remote.mux') throw new Error('Unsupported remote socket route')
    const url = new URL(path, this.address)
    url.protocol = 'wss:'
    const owned = create(url.href, this.#cookie)
    this.#sockets.add(owned)
    const release = (): void => { this.#sockets.delete(owned) }
    void owned.closed.then(release, release)
    return owned.socket
  }

  /** Forget credentials and cancel owned requests; does not stop server-side tasks. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#cookie = undefined
    ++this.#authenticationGeneration
    this.#lifetime.abort()
    for (const socket of this.#sockets) {
      try { socket.close() } catch { /* Continue releasing independently owned sockets. */ }
    }
    this.#sockets.clear()
  }

  private assertLive(): void {
    if (this.#disposed) throw new Error('Remote connector is disposed')
  }
}
