import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('loads the standalone artifact in the standard client module format without private endpoints', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: process.cwd() })
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const source = readFileSync('lib/client.js', 'utf8')
  let module: { id: string; factory(require: (name: string) => object): { apply: Function; inject: string[] }; meta(): { stylesheets: Record<string, { text(): string }> } } | undefined
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: typeof module) => { module = value } } } })
  expect(module?.id).toBe(manifest.name)
  const requests: string[] = []
  const exports = module!.factory(name => { requests.push(name); return {} })
  expect(exports.inject).toEqual(['slots', 'locale', 'layout'])
  expect(typeof exports.apply).toBe('function')
  expect([...new Set(requests)].sort()).toEqual(['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'].sort())
  expect(Object.values(module!.meta().stylesheets).map(style => style.text()).join('')).toContain('--dsw-alias-label-primary')
  expect(source).not.toMatch(/https:\/\/(?!example\.com)[a-z0-9.-]+/i)
  expect(source).not.toMatch(/\/root\/|[A-Z]:\\Users\\/)
})

it('ships an opt-in bundle row rather than changing a default profile', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(manifest.dsh.bundle.patch).toBe('cordis.patch.yml')
  expect(readFileSync('cordis.patch.yml', 'utf8')).toContain("name: 'dsh-remote-workspace'")
  expect(manifest.files).toContain('lib')
})
