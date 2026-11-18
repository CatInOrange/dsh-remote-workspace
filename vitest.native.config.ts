/** Native integration tests use the matching Harness checkout, never installed preview APIs. */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
const upstream = process.env.DSH_NATIVE_ROOT
if (!upstream) throw new Error('Set DSH_NATIVE_ROOT to the matching patched Harness checkout')
const require = createRequire(resolve(upstream, 'package.json'))
const ts = require('typescript') as typeof import('typescript')
const paths = ts.readConfigFile(resolve(upstream, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths as Record<string, string[]>
const alias = Object.entries(paths).filter(([key]) => !key.includes('*')).map(([find, values]) => ({ find, replacement: resolve(upstream, values[0]!) })).sort((a,b) => b.find.length - a.find.length)
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m
export default defineConfig({
  resolve: { alias: [
    { find: /^@native-harness\/(.*)$/, replacement: resolve(upstream) + '/$1' },
    { find: '@deepseek-ai/dsh-api-remote-access/remote', replacement: resolve(upstream, 'packages/api/remote-access/lib/typert.remote-client.js') },
    ...alias,
  ] },
  plugins: [{ name: 'native-standard-decorators', enforce: 'pre', transform(code, id) {
    const file = id.split('?', 1)[0]!
    if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
    const result = ts.transpileModule(code, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, sourceMap: true } })
    return { code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'), map: result.sourceMapText }
  } }],
  test: { include: ['tests/native-*.spec.ts'], maxWorkers: 1 },
})
