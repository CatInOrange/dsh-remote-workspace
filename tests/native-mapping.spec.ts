import { expect, it } from 'vitest'
import { isMappedIdentity, SingleWorkspaceMapping } from '../src/native/mapping.ts'

it('keeps identical Host ids separate by entity and selected workspace', () => {
  const a = new SingleWorkspaceMapping('a')
  const b = new SingleWorkspaceMapping('b')
  const raw = 'same-id'
  const mapped = a.uiId('session', raw)
  expect(new Set([raw, mapped, a.uiId('workspace', raw), b.uiId('session', raw)]).size).toBe(4)
  expect(a.remoteId('session', mapped)).toBe(raw)
  expect(() => b.remoteId('session', mapped)).toThrow()
  expect(() => a.remoteId('workspace', mapped)).toThrow()
  expect(isMappedIdentity(mapped)).toBe(true)
  expect(isMappedIdentity(raw)).toBe(false)
})

it('projects only the selected workspace without copying or changing server rows', () => {
  const mapping = new SingleWorkspaceMapping('wanted')
  const row = Object.freeze({ id: 'wanted', title: 'Project', sessionIds: Object.freeze(['session-1']) })
  const projected = mapping.projectWorkspace([{ id: 'other', sessionIds: ['private'] }, row])!
  expect(projected.title).toBe('Project')
  expect(mapping.remoteId('workspace', projected.id)).toBe('wanted')
  expect(projected.sessionIds.map(id => mapping.remoteId('session', id))).toEqual(['session-1'])
  expect(row.sessionIds).toEqual(['session-1'])
  expect(mapping.projectWorkspace([])).toBeUndefined()
  expect(() => mapping.projectWorkspace([row, row])).toThrow()
})

it('rejects malformed and stale identities instead of treating them as local ids', () => {
  const mapping = new SingleWorkspaceMapping('workspace')
  const id = mapping.uiId('session', 'id/with:unicode中文')
  expect(mapping.remoteId('session', id)).toBe('id/with:unicode中文')
  for (const invalid of ['', 'local-uuid', 'dsh-remote-workspace:v1:', id + ' ', id.replace('session', 'unknown')]) {
    expect(() => mapping.remoteId('session', invalid)).toThrow()
  }
  expect(() => new SingleWorkspaceMapping('')).toThrow()
  expect(() => mapping.uiId('session', '')).toThrow()
})
