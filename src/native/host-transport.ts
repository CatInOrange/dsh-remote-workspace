import type { ClientTransportHooks, ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectorSocket } from './connector.ts'
import { RemoteHostConnector } from './connector.ts'

/**
 * Bind native transport hooks to a Host-owned connector. Never send these hooks
 * or the cookie-bearing socket factory to a browser; a Client relay exposes
 * decoded requests instead. This adapter can run in the local Host only.
 * @param connector - authenticated, lifetime-owned remote connector.
 * @param socketFactory - Host socket implementation accepting the private cookie.
 * @returns transport with no ambient fetch, browser cookie, or socket fallback.
 */
export function createHostTransport(
  connector: RemoteHostConnector,
  socketFactory: (url: string, cookie: string) => ConnectorSocket<ConnectionWebSocket>,
): ClientTransportHooks {
  const address = new URL(connector.address + '/')
  return {
    fetch: (input, init) => {
      const url = new URL(input, address)
      if (url.origin !== address.origin || url.username || url.password || url.search || url.hash) {
        throw new Error('Remote transport destination refused')
      }
      return connector.fetch(url.pathname, init)
    },
    createWebSocket: input => {
      const url = new URL(input)
      const expected = new URL('api/remote.mux', address)
      expected.protocol = 'wss:'
      if (url.href !== expected.href) throw new Error('Remote socket destination refused')
      return connector.openWebSocket('/api/remote.mux', socketFactory)
    },
    streamBaseUrl: address.href,
  }
}
