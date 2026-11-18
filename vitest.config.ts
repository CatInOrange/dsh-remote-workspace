import { defineConfig } from 'vitest/config'
export default defineConfig({ test: {
  include: ['tests/**/*.spec.ts'],
  exclude: ['tests/native-runtime.spec.ts', 'tests/native-session-adapter.spec.ts', 'tests/native-source*.spec.ts', 'tests/native-controllers.spec.ts', 'tests/native-client-manager.spec.ts', 'tests/native-chat-integration.spec.ts'], maxWorkers: 1,
  execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
} })
