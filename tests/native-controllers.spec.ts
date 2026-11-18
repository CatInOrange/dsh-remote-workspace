import { describe, expect, it } from 'vitest'
import access from '@native-harness/packages/api/remote-access/lib/typert.remote-client.js'
import session from '@native-harness/packages/api/session-controller/lib/typert.remote-client.js'
import workspace from '@native-harness/packages/api/workspace-controller/lib/typert.remote-client.js'
import commands from '@native-harness/packages/interaction/commands/lib/typert.remote-client.js'
import subagents from '@native-harness/packages/subagent/subagent/lib/typert.remote-client.js'
import { createNativeWorkspaceRuntime } from '../src/native/runtime.ts'
import { createNativeControllers } from '../src/native/controllers.ts'

describe('remote native Controller assembly', () => {
  it('mounts real generated namespaces and controllers below an independent runtime', async () => {
    const calls: string[] = []
    const runtime = await createNativeWorkspaceRuntime({ address: 'https://linux.example', transport: { rpc: {
      call: async (_channel, endpoint) => { calls.push(endpoint); return { ok: true as const, value: { items: [], hasMore: false } } },
      open: async function* (_channel, endpoint, _payload, signal) {
        if (endpoint === '$events') yield { type: 'ready', clientId: 'remote-test', host: { home: '/linux' } }
        else if (endpoint === 'remoteAccess/follow') yield { type: 'baseline', owner: true }
        else if (endpoint === 'workspace/follow') yield { type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }
        else if (endpoint === 'session/control') yield { type: 'baseline', value: { projections: {} } }
        else throw new Error('Unexpected stream: ' + endpoint)
        await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
      },
    } } }, [session, workspace, commands, subagents])
    try {
      const uploads = { upload: async () => { throw new Error('unsupported') }, uploadImage: async () => { throw new Error('unsupported') } }
      const controllers = await createNativeControllers(runtime, uploads, access)
      expect(controllers.access).toBeDefined()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(controllers.access!.source('session', 'raw', 'session/prompt').getSnapshot()).toBe(true)
      expect(controllers.sessions).toBeDefined()
      expect(controllers.workspaces).toBeDefined()
      expect(controllers.ctx.get('fileUpload')).toBe(uploads)
      await expect(createNativeControllers(runtime, uploads, access)).rejects.toThrow('already installed')
      await controllers.dispose()
      expect(runtime.ctx.get('sessions')).toBeUndefined()
    } finally { await runtime.dispose() }
  })
})
