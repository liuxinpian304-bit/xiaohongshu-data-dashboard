import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.e2e-spec.ts'], fileParallelism: false, env: { DATABASE_URL: 'postgresql://postgres:postgres@localhost:55432/xhs_dashboard_test', NODE_ENV: 'test', DATABASE_ALLOW_PRIVILEGED_TEST_ROLE: 'true' } } });
