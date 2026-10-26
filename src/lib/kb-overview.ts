/**
 * 知识库概览块（Agent 常驻上下文之一，≤600 字）：让助手每轮都「了解我的知识库」。
 * 与画像块（learner-profile.profileToPromptBlock，≤400 字）合计 ≤1000 字注入 system。
 * 各查询并行；任一项失败该项写"—"，不抛错、不阻断对话。
 */
import { desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { adviceCandidates } from '@/lib/rag';
import { MEMORY_TIER_LABELS } from '@/lib/memory';

const MAX_CHARS = 600;

export async function buildKbOverview(): Promise<string> {
  // 记忆度口径与 /api/stats、lib/memory.ts 一致
  const m = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
  const read = sql`${segments.stability} > 0 and ${segments.lastViewedAt} is not null`;

  const [tiers, docCount, recentDocs, tagRows, weak] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where not (${read}))::int`,
        weak: sql<number>`count(*) filter (where ${read} and ${m} < 0.4)::int`,
        medium: sql<number>`count(*) filter (where ${read} and ${m} >= 0.4 and ${m} < 0.75)::int`,
        strong: sql<number>`count(*) filter (where ${read} and ${m} >= 0.75)::int`,
      })
      .from(segments)
      .catch(() => null),
    db.select({ n: sql<number>`count(*)::int` }).from(documents).catch(() => null),
    db
      .select({ title: documents.title })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(3)
      .catch(() => null),
    db
      .execute<{ tag: string; n: number }>(sql`
        select tag, count(*)::int as n
        from segments, unnest(tags) as tag
        group by tag order by n desc, tag asc limit 8
      `)
      .catch(() => null),
    adviceCandidates(3).catch(() => null),
  ]);

  const t = tiers?.[0];
  const L = MEMORY_TIER_LABELS;
  const lines = [
    '【知识库概览】',
    `- 规模：${docCount?.[0]?.n ?? '—'} 篇文档 · ${t?.total ?? '—'} 个知识点`,
    t
      ? `- 记忆分布：${L.unread} ${t.unread} · ${L.weak} ${t.weak} · ${L.medium} ${t.medium} · ${L.strong} ${t.strong}`
      : '- 记忆分布：—',
    `- 主题面：${tagRows?.rows?.length ? tagRows.rows.map((r) => `#${r.tag}`).join(' ') : '—'}`,
    `- 最近导入：${recentDocs?.length ? recentDocs.map((d) => `《${d.title}》`).join(' ') : '—'}`,
    `- 薄弱重点：${weak?.length ? weak.map((w) => `《${w.title}》`).join(' ') : '—'}`,
  ];
  return clampBlock(lines.join('\n'), MAX_CHARS);
}

/** 硬上限截断：保头尾（头部保留完整行、尾部保留结尾省略号语义） */
export function clampBlock(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.8);
  const tail = max - head - 1;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
