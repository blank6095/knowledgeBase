import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Windows 上 worker 启动超时会导致偶发「worker 未响应」并让整套用例假失败；
    // 限制并发后连续多轮运行稳定（32 个文件约 5 秒），CI 成本同样可忽略。
    maxWorkers: 2,
    // 关闭 Vitest 5 的文件模块缓存（node_modules/.vitest-cache）。
    // 该缓存会把「模块转换产物」落盘并跨进程复用；依赖升级后残留的旧产物会让
    // vitest 模块本身被加载成损坏状态，表现为每个测试文件在 describe() 处报
    // 「Cannot read properties of undefined (reading 'config')」，且 0 用例执行。
    // CI 每次 npm ci 全新安装不会踩到，本地残留才会，故显式关闭以保证质量门稳定。
    // 实测关闭后全量 63 文件 / 489 用例耗时 8.4s，与开启时持平。
    fsModuleCache: false,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
