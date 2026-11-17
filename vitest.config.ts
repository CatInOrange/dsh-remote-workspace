import { defineConfig } from 'vitest/config'
export default defineConfig({ test: {
  include: ['tests/**/*.spec.ts'], maxWorkers: 1,
  execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
} })
