import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SourceSessions, type ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { WorkspaceController, type ClientWorkspaceModel } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it, vi } from 'vitest'
import session from '@native-harness/packages/api/session-controller/lib/typert.remote-client.js'
import workspace from '@native-harness/packages/api/workspace-controller/lib/typert.remote-client.js'
import commands from '@native-harness/packages/interaction/commands/lib/typert.remote-client.js'
import subagents from '@native-harness/packages/subagent/subagent/lib/typert.remote-client.js'
import { ev, historyValue } from '@native-harness/packages/api/session-controller/tests/event-script.client.ts'
import { followSnapshot } from '@native-harness/packages/api/session-controller/tests/remote/history.client.ts'
import type { SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { createNativeWorkspaceRuntime } from '../src/native/runtime.ts'
import { createNativeControllers } from '../src/native/controllers.ts'
import { registerNativeSource } from '../src/native/source.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'

it('opens remote history and sends/stops through actual native bindings while identical local IDs stay isolated', async () => {
  const root = new Context()
  const localRetain = vi.fn()
  const sid = 'same' as SessionId
  const row = { id: sid, displayTitle: 'Local', running: false, blank: false, updatedAt: 0, retainedBy: {} }
  const local = { list: createSnapshotStore({ ids: [sid], byId: { same: row }, phase: 'ready', projectionsBySession: {} }), retain: localRetain, searchResultLimit: 30 } as unknown as ISessions
  const sessions = new SourceSessions(root, local)
  root.provide('sessions', sessions)
  const empty = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
  const workspaces = new WorkspaceController(root, createSnapshotStore(empty) as unknown as ClientWorkspaceModel)
  const calls: { endpoint: string; payload: unknown }[] = []
  const opened: SessionFollowRequest[] = []
  const runtime = await createNativeWorkspaceRuntime({ address: 'https://linux.example', transport: { rpc: {
    async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload })
      if (endpoint === 'session/list') return { ok: true, value: { items: [{ sessionId: sid, updatedAt: 1, running: false, blank: false, agentAvailable: true }] } }
      if (endpoint === 'session/create') return { ok: true, value: { sessionId: 'new-remote' } }
      if (endpoint === 'session/prompt' || endpoint === 'session/cancel') return { ok: true, value: { accepted: true } }
      throw new Error('Unexpected native unary call: ' + endpoint)
    },
    open: async function* (_channel, endpoint, payload, signal) {
      if (endpoint === '$events') yield { type: 'ready', clientId: 'remote-native', host: { home: '/linux' } }
      else if (endpoint === 'workspace/follow') yield { type: 'baseline', value: { ...empty, items: [{ workspaceId: 'w', path: '/linux', title: 'Linux', sessionIds: [sid], createdAt: '', updatedAt: '' }] } }
      else if (endpoint === 'session/control') yield { type: 'baseline', value: { projections: {} } }
      else if (endpoint === 'session/follow') {
        const request = (payload as { args: { request: SessionFollowRequest } }).args.request
        opened.push(request)
        yield followSnapshot(historyValue([ev.user(SessionSeq(0), 'remote history')]), request)
      } else throw new Error('Unexpected native stream: ' + endpoint)
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
    },
  } } }, [session, workspace, commands, subagents])
  let controllers: Awaited<ReturnType<typeof createNativeControllers>> | undefined
  let source: Awaited<ReturnType<typeof registerNativeSource>> | undefined
  try {
    controllers = await createNativeControllers(runtime, { upload: async () => { throw new Error('unsupported') }, uploadImage: async () => { throw new Error('unsupported') } })
    await vi.waitFor(() => expect(controllers!.workspaces.list.getSnapshot().items).toHaveLength(1))
    await vi.waitFor(() => expect(controllers!.sessions.list.getSnapshot().ids).toContain(sid))
    source = await registerNativeSource(root, controllers, 'w', 'native')
    source.setOnline(true)
    const mapped = new SingleWorkspaceMapping('w').uiId('session', sid) as SessionId
    expect(sessions.list.getSnapshot().ids).toEqual([sid, mapped])
    expect(workspaces.list.getSnapshot().items[0]?.sessionIds).toEqual([mapped])
    const reference = sessions.retain(mapped, { source: 'gateway' })
    const binding = await reference.ready
    expect(opened[0]?.address).toEqual({ kind: 'session', sessionId: sid })
    expect(JSON.stringify(binding.eventSource.getSnapshot())).toContain('remote history')
    expect(binding.source?.sessionId).toBe(sid)
    expect(binding.ctx).not.toBe(root)
    await expect(binding.session.prompt([{ type: 'text', text: 'hello Linux' }], 'queue')).resolves.toMatchObject({ ok: true })
    await expect(binding.session.cancel()).resolves.toMatchObject({ ok: true })
    expect(calls.find(call => call.endpoint === 'session/prompt')?.payload).toMatchObject({ args: { request: { sessionId: sid } } })
    expect(calls.find(call => call.endpoint === 'session/cancel')?.payload).toMatchObject({ args: { request: { sessionId: sid } } })
    const created = await sessions.create({ workspaceId: new SingleWorkspaceMapping('w').uiId('workspace', 'w') as never })
    expect(created).toBe(new SingleWorkspaceMapping('w').uiId('session', 'new-remote'))
    expect(calls.find(call => call.endpoint === 'session/create')?.payload).toEqual({ args: { request: { workspaceId: 'w' } } })
    expect(sessions.list.getSnapshot().ids).toContain(created)
    expect(localRetain).not.toHaveBeenCalled()
    source.setOnline(false)
    expect(() => binding.session.cancel()).toThrow('offline')
    reference.release()
  } finally { await source?.dispose(); await controllers?.dispose(); await runtime.dispose(); await root.fiber.dispose() }
})
