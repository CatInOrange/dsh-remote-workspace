/** Type-check the native consumer against the matching checkout's built declarations. */
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve, dirname, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = process.env.DSH_NATIVE_ROOT
if (!upstream) throw new Error('Set DSH_NATIVE_ROOT to the matching patched Harness checkout; build its declarations first')
const require = createRequire(resolve(upstream, 'package.json'))
const ts = require('typescript')
const source = ts.readConfigFile(resolve(upstream, 'tsconfig.base.json'), ts.sys.readFile).config
const paths = {}
const exists = async path => { try { await access(path); return true } catch { return false } }
for (const [specifier, values] of Object.entries(source.compilerOptions.paths)) {
  paths[specifier] = values.map(value => resolve(upstream, value))
  if (specifier.includes('*') || !specifier.startsWith('@deepseek-ai/')) continue
  let directory = dirname(paths[specifier][0])
  while (directory !== parse(directory).root && !await exists(resolve(directory, 'package.json'))) directory = dirname(directory)
  if (directory === parse(directory).root) continue
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (!specifier.startsWith(manifest.name)) continue
  const entry = '.' + specifier.slice(manifest.name.length)
  const type = manifest.exports?.[entry]?.types
  if (typeof type === 'string' && await exists(resolve(directory, type))) paths[specifier] = [resolve(directory, type)]
}
const remotes = {
  'dsh-api-session-controller': 'api/session-controller', 'dsh-api-workspace-controller': 'api/workspace-controller',
  'dsh-api-remote-access': 'api/remote-access', 'dsh-commands': 'interaction/commands',
  'dsh-subagent': 'subagent/subagent', 'dsh-user-questions': 'interaction/user-questions',
}
for (const [name, directory] of Object.entries(remotes)) paths[`@deepseek-ai/${name}/remote`] = [resolve(upstream, 'packages', directory, 'lib/typert.remote-client.d.ts')]
const react = dirname(require.resolve('@types/react/package.json'))
paths.react = [resolve(react, 'index.d.ts')]
paths['react/jsx-runtime'] = [resolve(react, 'jsx-runtime.d.ts')]
const scratch = resolve(root, '.native-check')
await mkdir(scratch, { recursive: true })
const config = resolve(scratch, 'tsconfig.json')
await writeFile(config, JSON.stringify({
  extends: resolve(upstream, 'tsconfig.base.client.json'),
  compilerOptions: { composite: false, incremental: false, noEmit: true, declaration: false, declarationMap: false, paths },
  include: [resolve(root, 'src/native/*.ts'), resolve(root, 'src/client/native-entry.tsx'), resolve(root, 'src/client/NativePanel.tsx'), resolve(upstream, 'packages/client/ui-layout/src/css-modules.d.ts')],
}, null, 2))
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config, '--pretty', 'false'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
