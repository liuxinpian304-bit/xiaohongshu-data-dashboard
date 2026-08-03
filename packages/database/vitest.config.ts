import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { env: { DATABASE_URL: 'postgresql://postgres:postgres@localhost:55432/xhs_dashboard', NODE_ENV: 'test', DATABASE_ALLOW_PRIVILEGED_TEST_ROLE: 'true' } } });
