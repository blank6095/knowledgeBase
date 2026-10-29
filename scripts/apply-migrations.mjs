/**
 * 通过 Neon HTTP 执行带版本记录的数据库迁移。
 *
 * 旧库没有 _kb_migrations 时，仅在当前 0000–0006 schema 完整的情况下自动建立基线；
 * 不完整或未知的旧库会停止执行，避免把半迁移状态误判为已完成。
 *
 * 用法：
 *   node --env-file=.env.local scripts/apply-migrations.mjs
 *   node --env-file=.env.local scripts/apply-migrations.mjs --dry-run
 *   node --env-file=.env.local scripts/apply-migrations.mjs --only 0007_xxx.sql
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL，用法：node --env-file=.env.local scripts/apply-migrations.mjs');
  process.exit(1);
}

const HISTORY_TABLE = '_kb_migrations';
const LEGACY_BASELINE = new Set([
  '0000_init.sql',
  '0001_fearless_lightspeed.sql',
  '0002_funny_tomorrow_man.sql',
  '0003_charming_selene.sql',
  '0004_vengeful_union_jack.sql',
  '0005_skinny_war_machine.sql',
  '0006_llm_calls_observability.sql',
]);
const dir = join(process.cwd(), 'src/db/migrations');
const dryRun = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const allFiles = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (allFiles.length === 0) {
  console.error('src/db/migrations 下没有迁移文件，先运行 npm run db:generate');
  process.exit(1);
}
if (only && !allFiles.includes(only)) {
  console.error(`没有匹配 --only ${only} 的迁移文件`);
  process.exit(1);
}

const entries = allFiles.map((name) => {
  const source = readFileSync(join(dir, name), 'utf8');
  const statements = source
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  return {
    name,
    checksum: createHash('sha256').update(source).digest('hex'),
    statements,
  };
});

const sql = neon(process.env.DATABASE_URL);

const [historyState] = await sql.query(
  `SELECT to_regclass($1)::text AS table_name`,
  [`public.${HISTORY_TABLE}`],
);
const historyExisted = Boolean(historyState?.table_name);

if (historyExisted) {
  const rows = await sql.query(`SELECT name, checksum FROM "${HISTORY_TABLE}" ORDER BY name`);
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));
  const changed = entries.find((entry) => applied.has(entry.name) && applied.get(entry.name) !== entry.checksum);
  if (changed) {
    console.error(`迁移 ${changed.name} 已在数据库执行，但文件内容已变化；请新增迁移，不要修改历史迁移`);
    process.exit(1);
  }
}

if (!historyExisted && !dryRun) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "${HISTORY_TABLE}" (
      "name" text PRIMARY KEY NOT NULL,
      "checksum" text NOT NULL,
      "applied_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
}

const appliedRows = historyExisted
  ? await sql.query(`SELECT name, checksum FROM "${HISTORY_TABLE}" ORDER BY name`)
  : [];
const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));

const [schemaState] = await sql.query(`
  SELECT
    to_regclass('public.documents') IS NOT NULL AS has_documents,
    to_regclass('public.segments') IS NOT NULL AS has_segments,
    to_regclass('public.reading_events') IS NOT NULL AS has_reading_events,
    to_regclass('public.annotations') IS NOT NULL AS has_annotations,
    to_regclass('public.app_settings') IS NOT NULL AS has_app_settings,
    to_regclass('public.llm_cache') IS NOT NULL AS has_llm_cache,
    to_regclass('public.llm_calls') IS NOT NULL AS has_llm_calls,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'segments'
        AND column_name IN ('stability', 'reading_ms', 'summary')) = 3 AS has_segment_columns,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'llm_cache'
        AND column_name = 'expires_at') = 1 AS has_cache_expiry,
    to_regclass('public.review_logs') IS NULL AS old_review_table_removed,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'segments'
        AND column_name IN ('ease', 'interval_days', 'reps', 'lapses', 'last_grade', 'due_at', 'mastery', 'status')) = 0
      AS old_segment_columns_removed
`);

const legacyComplete =
  schemaState?.has_documents &&
  schemaState?.has_segments &&
  schemaState?.has_reading_events &&
  schemaState?.has_annotations &&
  schemaState?.has_app_settings &&
  schemaState?.has_llm_cache &&
  schemaState?.has_llm_calls &&
  schemaState?.has_segment_columns &&
  schemaState?.has_cache_expiry &&
  schemaState?.old_segment_columns_removed;
const anyAppTable =
  schemaState?.has_documents ||
  schemaState?.has_segments ||
  schemaState?.has_reading_events ||
  schemaState?.has_annotations ||
  schemaState?.has_app_settings ||
  schemaState?.has_llm_cache ||
  schemaState?.has_llm_calls;

if (applied.size === 0 && legacyComplete) {
  const baseline = entries.filter((entry) => LEGACY_BASELINE.has(entry.name) && !applied.has(entry.name));
  if (baseline.length > 0) {
    console.log(`检测到完整旧库，建立 ${baseline.length} 条迁移基线${dryRun ? '（dry-run）' : ''}`);
    if (!dryRun) {
      await sql.transaction(
        baseline.map((entry) =>
          sql.query(
            `INSERT INTO "${HISTORY_TABLE}" (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
            [entry.name, entry.checksum],
          ),
        ),
      );
    }
    for (const entry of baseline) applied.set(entry.name, entry.checksum);
  }
} else if (anyAppTable && !legacyComplete) {
  const missing = [
    ['documents 表', schemaState?.has_documents],
    ['segments 表', schemaState?.has_segments],
    ['reading_events 表', schemaState?.has_reading_events],
    ['annotations 表', schemaState?.has_annotations],
    ['app_settings 表', schemaState?.has_app_settings],
    ['llm_cache 表', schemaState?.has_llm_cache],
    ['llm_calls 表', schemaState?.has_llm_calls],
    ['segments 新记忆字段', schemaState?.has_segment_columns],
    ['llm_cache.expires_at', schemaState?.has_cache_expiry],
    ['segments 旧 SM-2 字段已移除', schemaState?.old_segment_columns_removed],
  ]
    .filter(([, ok]) => !ok)
    .map(([label]) => label)
    .join('、');
  console.error(
    `检测到未版本化且 schema 不完整的数据库，已停止迁移。待核对：${missing}。请先备份并按现有 schema 人工核对，再新增补丁迁移。`,
  );
  process.exit(1);
}

const selected = entries.filter((entry) => !only || entry.name === only);
const pending = selected.filter((entry) => !applied.has(entry.name));

if (only) {
  const pendingEarlier = entries
    .slice(0, entries.findIndex((entry) => entry.name === only))
    .filter((entry) => !applied.has(entry.name));
  if (pendingEarlier.length > 0) {
    console.error(`--only 前仍有未执行迁移：${pendingEarlier.map((entry) => entry.name).join(', ')}`);
    process.exit(1);
  }
}

if (pending.length === 0) {
  console.log('数据库已是最新，无需执行迁移');
  process.exit(0);
}

for (const entry of pending) {
  console.log(`${dryRun ? '[dry-run] ' : ''}${entry.name}: ${entry.statements.length} 条语句`);
  if (dryRun) continue;
  try {
    await sql.transaction((txn) => [
      ...entry.statements.map((statement) => txn.query(statement)),
      txn.query(`INSERT INTO "${HISTORY_TABLE}" (name, checksum) VALUES ($1, $2)`, [
        entry.name,
        entry.checksum,
      ]),
    ]);
  } catch (error) {
    console.error(`${entry.name} 执行失败，事务已回滚：${error.message}`);
    process.exit(1);
  }
}

console.log(dryRun ? '迁移检查完成，未写入数据库' : '全部迁移执行完成');
