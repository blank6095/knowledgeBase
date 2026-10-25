/**
 * 通过 Neon HTTP 驱动按顺序执行 src/db/migrations 下的迁移 SQL。
 *
 * 背景：drizzle-kit push 在部分网络环境下走 websocket 驱动会卡住，
 * 本脚本用 HTTP 驱动逐条执行，效果等价且稳定。
 *
 * 用法：node --env-file=.env.local scripts/apply-migrations.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL，用法：node --env-file=.env.local scripts/apply-migrations.mjs');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const dir = join(process.cwd(), 'src/db/migrations');
// --only <文件名>：只执行指定迁移。已知陷阱：全量重放会卡死在早期迁移
// （后续迁移删过列，旧迁移不可重放），因此新增迁移后必须单独执行。
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !only || f === only)
  .sort();

if (files.length === 0) {
  console.error(only ? `没有匹配 --only ${only} 的迁移文件` : 'src/db/migrations 下没有迁移文件，先运行 npm run db:generate');
  process.exit(1);
}

// 已存在的对象视为跳过（重复执行安全）
const SKIPPABLE = new Set(['42P07', '42710', '42704', '42P16', '42P06', '42701']);

for (const file of files) {
  const statements = readFileSync(join(dir, file), 'utf-8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  console.log(`${file}: ${statements.length} 条语句`);
  for (const [i, stmt] of statements.entries()) {
    try {
      await sql.query(stmt);
    } catch (e) {
      if (SKIPPABLE.has(e.code)) {
        console.log(`  [${i + 1}] 已存在，跳过`);
        continue;
      }
      console.error(`  [${i + 1}] 失败:`, e.message);
      process.exit(1);
    }
  }
}
console.log('全部迁移执行完成');
