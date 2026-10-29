import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // 测试固定放在 src/ 下：显式 include 可避免工作区里指向 src 的符号链接
  // （如 云端知识库/src）让同一批用例被重复收集。
  test: { environment: 'node', include: ['src/**/*.{test,spec}.{ts,tsx}'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
