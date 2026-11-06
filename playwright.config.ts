import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // 同一 dev server 下并发跑 6 个页面会导致冷编译/渲染资源争抢，
  // 出现「导航完成但内容 5s 未出现」的假失败；文件内串行、文件间仍可并行。
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
});
