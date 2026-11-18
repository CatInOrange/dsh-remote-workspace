/** Export only native integration changes; leave legacy guest persistence and user data out. */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = process.env.DSH_NATIVE_ROOT
if (!upstream) throw new Error('Set DSH_NATIVE_ROOT to the matching patched checkout')
const base = '39163dd30f703a79079e2d2446545cff3c453738'
const git = args => execFileSync('git', args, { cwd: upstream, encoding: 'utf8' }).trim()
if (git(['rev-parse', 'HEAD']) !== base) throw new Error('Native patch export requires the reviewed base commit')
const selected = path => /^(?:packages\/api\/(?:gateway|session-controller|workspace-controller|remote-access)\/|packages\/client\/(?:ui-model-selection|ui-agent-preset|ui-chat|ui-conversation|ui-session-status|ui-user-questions)\/)/.test(path)
  || /^apps\/desktop\/src\/(?:native-remote[^/]*|preload-native-remote\.ts|ipc\.ts|main\.ts|preload-app\.ts)$/.test(path)
  || /^apps\/desktop\/tests\/(?:native-remote\.spec\.ts|fixtures\/native-remote-bridge-smoke\.cjs)$/.test(path)
const files = [...new Set([...git(['diff', '--name-only']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')])].filter(selected).sort()
const temporary = mkdtempSync(join(tmpdir(), 'dsh-native-patch-'))
let patch = ''
for (const file of files) {
  const previous = spawnSync('git', ['show', `${base}:${file}`], { cwd: upstream, encoding: 'utf8' })
  const oldFile = previous.status === 0 ? resolve(temporary, 'base', file) : '/dev/null'
  const nextFile = resolve(temporary, 'next', file)
  let content = readFileSync(resolve(upstream, file), 'utf8')
  if (file === 'apps/desktop/src/main.ts') content = content
    .replace('DESKTOP_IPC.browserAcquire, (event, workspace: unknown, options: unknown)', 'DESKTOP_IPC.browserAcquire, (event, workspace: unknown)')
    .replace('browserGuests.acquire(event.sender, workspace, options)', 'browserGuests.acquire(event.sender, workspace)')
  mkdirSync(dirname(nextFile), { recursive: true }); writeFileSync(nextFile, content)
  if (oldFile !== '/dev/null') { mkdirSync(dirname(oldFile), { recursive: true }); writeFileSync(oldFile, previous.stdout) }
  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--', oldFile, nextFile], { encoding: 'utf8' })
  if (diff.status !== 0 && diff.status !== 1) throw new Error(diff.stderr)
  patch += diff.stdout.replaceAll(`a${temporary}/base/`, 'a/').replaceAll(`a${temporary}/next/`, 'a/').replaceAll(`b${temporary}/next/`, 'b/')
}
writeFileSync(resolve(root, 'patches/native-client.patch'), patch)
console.log(`Exported ${files.length} native source/test/documentation paths against ${base}`)
