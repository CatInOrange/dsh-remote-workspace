/** Opt-in unsigned developer packaging only. Signed/official packaging is unchanged. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const upstream = process.env.DSH_NATIVE_ROOT
if (!upstream) throw new Error('Set DSH_NATIVE_ROOT to the patched checkout')
function edit(path, before, after) {
  const filename = resolve(upstream, path)
  const source = readFileSync(filename, 'utf8')
  if (source.split(before).length !== 2) throw new Error(`Unexpected packaging source: ${path}`)
  writeFileSync(filename, source.replace(before, after))
}
edit('apps/desktop/scripts/package-target.ts',
  "  const environment = target.platform === 'darwin' && invocation.unsigned\n    ? localMacOSPackageEnvironment()",
  "  const nativeTest = process.env.DSH_NATIVE_TEST_BUILD === '1'\n  if (nativeTest && !invocation.unsigned) throw new Error('Native developer builds must be unsigned')\n  const environment = (target.platform === 'darwin' && invocation.unsigned) || nativeTest\n    ? { ...localMacOSPackageEnvironment(), ...(nativeTest ? { DSH_DESKTOP_APP_ID: 'com.catinorange.harness.native' } : {}) }")
edit('apps/desktop/scripts/desktop-package-environment.mjs',
  "  if (target.platform !== 'darwin' || !options.unsigned) resolveDesktopPolicyEnvironment(environment)",
  "  if (!(options.unsigned && environment.DSH_NATIVE_TEST_BUILD === '1') && (target.platform !== 'darwin' || !options.unsigned)) resolveDesktopPolicyEnvironment(environment)")
edit('apps/desktop/scripts/electron-builder-config.mjs',
  "  const policy = packagesMacOS && unsigned ? undefined : resolveDesktopPolicyEnvironment(env)",
  "  const nativeTest = env.DSH_NATIVE_TEST_BUILD === '1'\n  if (nativeTest && !unsigned) throw new Error('Native developer builds must be unsigned')\n  const policy = (packagesMacOS && unsigned) || nativeTest ? undefined : resolveDesktopPolicyEnvironment(env)")
edit('apps/desktop/scripts/electron-builder-config.mjs',
  "    protocols: [{ name: 'DeepSeek Harness', schemes: ['dsh'] }],",
  "    protocols: nativeTest ? [] : [{ name: 'DeepSeek Harness', schemes: ['dsh'] }],")
edit('apps/desktop/scripts/electron-builder-config.mjs',
  "    extraMetadata: {\n      dshDesktopAppId: appId,",
  "    extraMetadata: {\n      ...(nativeTest ? { name: 'dsh-native-workspace-test', productName: 'DeepSeek Harness Native Test' } : {}),\n      dshDesktopAppId: appId,")
edit('apps/desktop/scripts/electron-builder-config.mjs',
  "    productName: 'DeepSeek Harness',",
  "    productName: nativeTest ? 'DeepSeek Harness Native Test' : 'DeepSeek Harness',")
console.log('Prepared opt-in unsigned native test packaging; separate app identity, no production updater or URL registration')
