import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | undefined;

function getDb(): Db {
  if (!instance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('缺少环境变量 DATABASE_URL（Neon 连接串，见 .env.example）');
    }
    instance = drizzle(neon(process.env.DATABASE_URL), { schema }) as Db;
  }
  return instance;
}

/**
 * 惰性初始化的数据库客户端：`next build` 收集页面数据时会导入各路由模块，
 * 那时可能尚未配置 DATABASE_URL，所以连接推迟到第一次真正查询时建立。
 */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
