/** Build the standard DSH lazy-CJS client module without an upstream checkout. */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const stylesheets = {}
const cssModules = {
  name: 'dsh-remote-workspace-css',
  setup(context) {
    context.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
      const source = await readFile(path)
      const filename = relative(root, path).replaceAll('\\', '/')
      const result = transform({ filename, code: source, cssModules: { pattern: 'remote_[local]_[hash]' }, minify: true })
      stylesheets[filename] = result.code.toString()
      const classes = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, entry]) => [key, entry.name]))
      return { contents: `export default ${JSON.stringify(classes)}`, loader: 'js', watchFiles: [path] }
    })
  },
}
await mkdir(resolve(root, 'lib'), { recursive: true })
await build({
  absWorkingDir: root, entryPoints: ['src/index.ts'], outfile: 'lib/index.js',
  bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: false,
})
const result = await build({
  absWorkingDir: root, entryPoints: ['src/client/index.ts'], bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', write: false, sourcemap: false,
  jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'], plugins: [cssModules],
})
const metadata = Object.entries(stylesheets).map(([path, css]) => `${JSON.stringify(path)}: { text: () => ${JSON.stringify(css)} }`).join(',')
const client = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    var module = { exports: {} }; var exports = module.exports;\n${result.outputFiles[0].text}\n    return module.exports;\n  },\n  meta: () => ({ stylesheets: {${metadata}} })\n});\n`
await writeFile(resolve(root, 'lib/client.js'), client)
console.error('Built lib/index.js and lib/client.js')
