import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // 测试固定放在 src/ 下：显式 include 可避免工作区里指向 src 的符号链接
  // （如 云端知识库/src）让同一批用例被重复收集。
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Windows 上 worker 启动超时会导致偶发「worker 未响应」并让整套用例假失败；
    // 限制并发后连续多轮运行稳定（32 个文件约 5 秒），CI 成本同样可忽略。
    maxWorkers: 2,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
