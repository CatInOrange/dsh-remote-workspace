/** Build the unreleased native entry against generated contributions from the matching checkout. */
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = process.env.DSH_NATIVE_ROOT
if (!upstream) throw new Error('Set DSH_NATIVE_ROOT to the matching patched Harness checkout')
const remotePackages = {
  '@deepseek-ai/dsh-user-questions/remote': 'packages/interaction/user-questions/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-api-remote-access/remote': 'packages/api/remote-access/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-api-session-controller/remote': 'packages/api/session-controller/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-api-workspace-controller/remote': 'packages/api/workspace-controller/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-commands/remote': 'packages/interaction/commands/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-subagent/remote': 'packages/subagent/subagent/lib/typert.remote-client.js',
  '@deepseek-ai/dsh-typert-protocol/remote-info': 'packages/typert/protocol/src/remote-info.ts',
}
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const result = await build({
  absWorkingDir: root, entryPoints: ['src/client/native-entry.tsx'], bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', write: false, jsx: 'automatic',
  nodePaths: [resolve(upstream, 'node_modules')], external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  plugins: [{ name: 'native-generated-contributions', setup(context) {
    context.onResolve({ filter: /^@deepseek-ai\// }, args => {
      const file = remotePackages[args.path]
      return file === undefined ? undefined : { path: resolve(upstream, file), external: false }
    })
  } }],
})
const staging = resolve(root, 'native-dist')
await mkdir(resolve(staging, 'lib'), { recursive: true })
const source = result.outputFiles[0].text
// Keep the default preview artifact untouched until native acceptance gates pass.
await writeFile(resolve(staging, 'lib/client.js'), `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${source}\nreturn module.exports; }, meta: () => ({ stylesheets: {} }) });\n`)
console.log('Built native-dist/lib/client.js (unreleased native replacement)')


await writeFile(resolve(staging, 'lib/index.js'), 'export function apply() {}\n')
const nativeManifest = {
  ...manifest, version: '0.2.0-native.0',
  description: 'Unreleased native single remote workspace mapping; requires patched desktop',
  scripts: undefined,
  dsh: { ...manifest.dsh, client: {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-workspace-controller', '@deepseek-ai/dsh-api-remote-access'],
    external: ['@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-connection/client',
      '@deepseek-ai/dsh-typert-registry/client', '@deepseek-ai/dsh-api-gateway/client',
      '@deepseek-ai/dsh-api-session-controller/client', '@deepseek-ai/dsh-api-workspace-controller/client', '@deepseek-ai/dsh-api-remote-access/client'],
  } },
}
await writeFile(resolve(staging, 'package.json'), JSON.stringify(nativeManifest, null, 2) + '\n')
for (const file of ['cordis.patch.yml', 'LICENSE']) await copyFile(resolve(root, file), resolve(staging, file))
await writeFile(resolve(staging, 'README.md'), '# Native workspace mapping — development artifact\n\nRequires the matching patched Harness desktop. No Windows acceptance yet. Authentication is process-local; attachments are disabled. Remapping after disconnect currently requires reload. See repository NATIVE-MAPPING.md for remaining gates.\n')
console.log('Staged native-dist; preview artifacts unchanged')
