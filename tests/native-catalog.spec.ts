import { expect, it, vi } from 'vitest'
import { NativeWorkspaceCatalog } from '../src/native/catalog.ts'
import { SingleWorkspaceMapping } from '../src/native/mapping.ts'

const localWorkspace = { id: 'same-workspace', title: 'Local', sessionIds: ['same-session'] }
const remoteWorkspace = { id: 'same-workspace', title: 'Remote', sessionIds: ['same-session', 'not-in-baseline'] }
const mapping = new SingleWorkspaceMapping(remoteWorkspace.id)

it('keeps local and remote identities distinct and exposes only selected remote sessions', () => {
  const catalog = new NativeWorkspaceCatalog<typeof localWorkspace, { id: string; displayTitle: string }>()
  catalog.replaceLocal([localWorkspace], [{ id: 'same-session', displayTitle: 'Local session' }])
  const feed = catalog.selectRemote(remoteWorkspace.id)
  feed.replace([remoteWorkspace, { id: 'other', title: 'Hidden', sessionIds: ['private'] }], [
    { id: 'same-session', displayTitle: 'Remote session' },
    { id: 'private', displayTitle: 'Hidden session' },
  ])
  expect(catalog.getSnapshot().workspaces.map(row => row.title)).toEqual(['Local', 'Remote'])
  expect(catalog.getSnapshot().sessions.map(row => row.displayTitle)).toEqual(['Local session', 'Remote session'])
  expect(catalog.routeSession('same-session')).toEqual({ source: 'local', id: 'same-session' })
  expect(catalog.routeSession(mapping.uiId('session', 'same-session'))).toEqual({ source: 'remote', id: 'same-session' })
  expect(catalog.routeWorkspace(mapping.uiId('workspace', remoteWorkspace.id))).toEqual({ source: 'remote', id: remoteWorkspace.id })
  for (const raw of ['private', 'not-in-baseline']) {
    expect(() => catalog.routeSession(mapping.uiId('session', raw))).toThrow('unavailable')
  }
})

it('retains remote rows offline, fails remote routing and leaves local updates usable', () => {
  const catalog = new NativeWorkspaceCatalog()
  catalog.replaceLocal([localWorkspace], [{ id: 'same-session' }])
  const feed = catalog.selectRemote(remoteWorkspace.id)
  feed.replace([remoteWorkspace], [{ id: 'same-session' }])
  feed.offline()
  expect(catalog.getSnapshot().remoteState).toBe('offline')
  expect(catalog.getSnapshot().workspaces).toHaveLength(2)
  expect(() => catalog.routeSession(mapping.uiId('session', 'same-session'))).toThrow('unavailable')
  catalog.replaceLocal([{ ...localWorkspace, sessionIds: ['new-local'] }], [{ id: 'new-local' }])
  expect(catalog.routeSession('new-local')).toEqual({ source: 'local', id: 'new-local' })
  expect(catalog.getSnapshot().remoteState).toBe('offline')
  feed.replace([remoteWorkspace], [{ id: 'same-session' }])
  expect(catalog.routeSession(mapping.uiId('session', 'same-session')).source).toBe('remote')
})

it('retires previous feeds on switch, unmap and disposal without local fallback', () => {
  const catalog = new NativeWorkspaceCatalog()
  const oldFeed = catalog.selectRemote(remoteWorkspace.id)
  oldFeed.replace([remoteWorkspace], [{ id: 'same-session' }])
  const nextFeed = catalog.selectRemote('next')
  expect(catalog.getSnapshot().workspaces).toEqual([])
  oldFeed.replace([remoteWorkspace], [{ id: 'same-session' }])
  oldFeed.offline()
  expect(catalog.getSnapshot().remoteState).toBe('loading')
  nextFeed.replace([{ id: 'next', sessionIds: ['next-session'] }], [{ id: 'next-session' }])
  expect(() => catalog.routeSession(mapping.uiId('session', 'same-session'))).toThrow('unavailable')
  catalog.clearRemote()
  const snapshot = catalog.getSnapshot()
  nextFeed.replace([{ id: 'next', sessionIds: [] }], [])
  expect(catalog.getSnapshot()).toBe(snapshot)
  expect(() => catalog.routeSession('missing')).toThrow('Unknown local')
  expect(() => catalog.routeSession('dsh-remote-workspace:v1:malformed')).toThrow('unavailable')
  catalog.dispose()
  expect(() => catalog.routeSession('anything')).toThrow('disposed')
  nextFeed.offline()
})

it('owns stable snapshots and published membership arrays, and unsubscribes observers', () => {
  const catalog = new NativeWorkspaceCatalog()
  const listener = vi.fn()
  const off = catalog.subscribe(listener)
  const initial = catalog.getSnapshot()
  expect(catalog.getSnapshot()).toBe(initial)
  const row = { id: 'local', sessionIds: ['a'] }
  catalog.replaceLocal([row], [{ id: 'a' }])
  expect(listener).toHaveBeenCalledTimes(1)
  const next = catalog.getSnapshot()
  expect(next).not.toBe(initial)
  row.sessionIds.push('later')
  expect(next.workspaces[0]?.sessionIds).toEqual(['a'])
  off()
  off()
  catalog.clearRemote()
  expect(listener).toHaveBeenCalledTimes(1)
})

it('rejects ambiguous local identities and invalid updates atomically', () => {
  const catalog = new NativeWorkspaceCatalog()
  catalog.replaceLocal([localWorkspace], [{ id: 'same-session' }])
  const before = catalog.getSnapshot()
  expect(() => catalog.replaceLocal([{ id: mapping.uiId('workspace', 'x'), sessionIds: [] }], [])).toThrow('reserved')
  expect(catalog.getSnapshot()).toBe(before)
  const feed = catalog.selectRemote(remoteWorkspace.id)
  feed.replace([remoteWorkspace], [{ id: 'same-session' }])
  const accepted = catalog.getSnapshot()
  expect(() => feed.replace([remoteWorkspace, remoteWorkspace], [])).toThrow('duplicate')
  expect(catalog.getSnapshot()).toBe(accepted)
  feed.replace([], [])
  expect(catalog.getSnapshot().workspaces).toEqual([localWorkspace])
  expect(() => catalog.routeWorkspace(mapping.uiId('workspace', remoteWorkspace.id))).toThrow('unavailable')
})

it('contains failing observers and closes before disposal observers run', () => {
  const catalog = new NativeWorkspaceCatalog()
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const survivor = vi.fn()
  catalog.subscribe(() => { throw new Error('observer fault') })
  catalog.subscribe(survivor)
  try {
    catalog.replaceLocal([localWorkspace], [{ id: 'same-session' }])
    expect(survivor).toHaveBeenCalledTimes(1)
    catalog.subscribe(() => { expect(() => catalog.selectRemote('late')).toThrow('disposed') })
    catalog.dispose()
    expect(survivor).toHaveBeenCalledTimes(2)
    expect(catalog.getSnapshot().remoteState).toBe('unmapped')
    expect(report).toHaveBeenCalledTimes(2)
  } finally { report.mockRestore() }
})
