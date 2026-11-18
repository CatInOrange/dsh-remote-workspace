import { Context } from '@deepseek-ai/cordis'
import { installConnection, type ClientTransportHooks, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import * as registry from '@deepseek-ai/dsh-typert-registry/client'
import { createClientRemoteRuntime, type ClientRemoteRuntime } from '@deepseek-ai/dsh-api-gateway/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/** Credential-free Client relay. Authentication and cookie ownership stay on the local Host. */
export interface NativeRuntimeTransport {
  readonly address: string
  readonly transport: ClientTransportHooks
}

/** An independent registry, Connection and generated Remote namespace owner. */
export interface NativeWorkspaceRuntime extends ClientRemoteRuntime {
  readonly connection: ConnectionHandle
}

/**
 * Assemble a remote Client runtime without borrowing any local page services.
 * Contributions must be the generated /remote exports from the matching Harness build.
 * The relay must supply both HTTP and authenticated sockets, or a complete decoded RPC carrier.
 * @param carrier - explicit credential-free carrier supplied by the Host relay.
 * @param contributions - only capabilities selected for this remote source.
 * @returns isolated runtime; disposal withdraws namespaces and streams, not server sessions.
 */
export async function createNativeWorkspaceRuntime(
  carrier: NativeRuntimeTransport,
  contributions: readonly TypertRemoteContribution[],
): Promise<NativeWorkspaceRuntime> {
  const target = new URL(carrier.address)
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
    throw new Error('Native remote runtime requires a credential-free HTTPS address')
  }
  const transport = carrier.transport
  if (transport.ownsHost) throw new Error('Remote runtime cannot own the local Host')
  if (transport.rpc !== undefined) {
    if (transport.rpc.open === undefined) throw new Error('Remote RPC carrier must provide streams')
  } else if (transport.fetch === undefined || transport.createWebSocket === undefined) {
    throw new Error('Remote carrier must provide HTTP and authenticated sockets')
  }
  const ctx = new Context()
  let runtime: ClientRemoteRuntime | undefined
  try {
    await ctx.plugin(registry)
    installConnection(ctx, {
      interactions: 'answer',
      // Classify the actual remote authority, never the Windows page's localhost.
      location: { hostname: target.hostname },
      transport: { ...transport, streamBaseUrl: target.href },
    })
    const connection = ctx.get('connection') as ConnectionHandle
    runtime = await createClientRemoteRuntime(ctx, connection)
    for (const contribution of contributions) await runtime.remote.$mount(contribution)
    let disposal: Promise<void> | undefined
    return {
      ctx: runtime.ctx,
      remote: runtime.remote,
      connection,
      dispose: () => disposal ??= ctx.fiber.dispose(),
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
