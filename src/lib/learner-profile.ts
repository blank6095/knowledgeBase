/**
 * 学习者画像：从五项数据源推导（全部 SQL 下推聚合，禁止全表拉回 JS）——
 * 记忆档位分布（复用 stats 的 CASE 聚合表达式）、薄弱知识点（exp(-Δt/S) 判定）、
 * 阅读行为（reading_events / readingMs）、最近标注（quote/note）、图谱枢纽度数。
 * 供 ask / 拆解 / 聚合 的 prompt 注入；本身不做任何业务数据写入。
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { annotations, appSettings, links, readingEvents, segments } from '@/db/schema';

export interface LearnerProfile {
  totalSegments: number;
  tiers: { unread: number; weak: number; medium: number; strong: number };
  /** 已读且记忆 <0.4 的知识点（升序，最薄弱在前，top5） */
  weakSpots: { segmentId: string; title: string; memory: number }[];
  reading: { events7d: number; totalReadingMs: number; lastReadAt: string | null };
  /** 最近 5 条有实质内容（划线引文或笔记正文）的标注 */
  recentNotes: { segmentTitle: string; quote: string | null; note: string | null }[];
  /** 关联度最高的知识点 top3（出度+入度） */
  hubs: { segmentId: string; title: string; degree: number }[];
}

const DECLARATION_KEY = 'learner';

/** 学习者自述声明（app_settings key='learner'，value jsonb {declaration}），与 'llm' 同款模式 */
export async function getLearnerDeclaration(): Promise<string> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, DECLARATION_KEY));
  const v = row?.value as { declaration?: unknown } | undefined;
  return typeof v?.declaration === 'string' ? v.declaration : '';
}

export async function saveLearnerDeclaration(declaration: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: DECLARATION_KEY, value: { declaration } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { declaration }, updatedAt: new Date() },
    });
}

/** 记忆度表达式（与 src/lib/memory.ts memoryOf 一致） */
const MEMORY_EXPR = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
const READ = sql`${segments.stability} > 0 and ${segments.lastViewedAt} is not null`;

/** 五项 SQL 聚合并行推导画像 */
export async function deriveLearnerProfile(): Promise<LearnerProfile | null> {
  const [tierRow, weakRows, readRow, eventRow, noteRows, hubRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where not (${READ}))::int`,
        weak: sql<number>`count(*) filter (where ${READ} and ${MEMORY_EXPR} < 0.4)::int`,
        medium: sql<number>`count(*) filter (where ${READ} and ${MEMORY_EXPR} >= 0.4 and ${MEMORY_EXPR} < 0.75)::int`,
        strong: sql<number>`count(*) filter (where ${READ} and ${MEMORY_EXPR} >= 0.75)::int`,
      })
      .from(segments),
    db
      .select({ id: segments.id, title: segments.title, memory: sql<number>`(${MEMORY_EXPR})::float8` })
      .from(segments)
      .where(sql`${READ} and ${MEMORY_EXPR} < 0.4`)
      .orderBy(sql`${MEMORY_EXPR} asc`)
      .limit(5),
    db
      .select({
        totalReadingMs: sql<number>`coalesce(sum(${segments.readingMs}), 0)::bigint`,
        lastReadAt: sql<string | null>`max(${segments.lastViewedAt})::text`,
      })
      .from(segments),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(readingEvents)
      .where(sql`${readingEvents.startedAt} >= now() - interval '7 days'`),
    db
      .select({
        segmentTitle: segments.title,
        quote: annotations.quote,
        note: annotations.note,
      })
      .from(annotations)
      .innerJoin(segments, eq(annotations.segmentId, segments.id))
      .where(sql`coalesce(${annotations.quote}, '') <> '' or coalesce(${annotations.note}, '') <> ''`)
      .orderBy(desc(annotations.createdAt))
      .limit(5),
    db
      .select({
        id: segments.id,
        title: segments.title,
        degree: sql<number>`(
          (select count(*) from ${links} where ${links.fromId} = ${segments.id}) +
          (select count(*) from ${links} where ${links.toId} = ${segments.id})
        )::int`,
      })
      .from(segments)
      .orderBy(sql`3 desc`)
      .limit(3),
  ]);

  return {
    totalSegments: tierRow[0]?.total ?? 0,
    tiers: {
      unread: tierRow[0]?.unread ?? 0,
      weak: tierRow[0]?.weak ?? 0,
      medium: tierRow[0]?.medium ?? 0,
      strong: tierRow[0]?.strong ?? 0,
    },
    weakSpots: weakRows.map((r) => ({ segmentId: r.id, title: r.title, memory: Number(r.memory) })),
    reading: {
      events7d: eventRow[0]?.n ?? 0,
      totalReadingMs: Number(readRow[0]?.totalReadingMs ?? 0),
      lastReadAt: readRow[0]?.lastReadAt ?? null,
    },
    recentNotes: noteRows.map((r) => ({ segmentTitle: r.segmentTitle, quote: r.quote, note: r.note })),
    hubs: hubRows.map((r) => ({ segmentId: r.id, title: r.title, degree: Number(r.degree) })),
  };
}

const fmtMinutes = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
};

/**
 * 画像 → 中文 prompt 块（纯函数）。库为空返回空串（不注入）。
 * 建议类问题的 prompt 也复用此块（推荐理由可引用薄弱点与未读主题）。
 */
export function profileToPromptBlock(profile: LearnerProfile | null, declaration?: string): string {
  if (!profile || profile.totalSegments === 0) return '';
  const lines: string[] = ['学习者画像（供个性化参考）：'];

  const { unread, weak, medium, strong } = profile.tiers;
  lines.push(
    `- 知识库共 ${profile.totalSegments} 个知识点：未读 ${unread}、微光（弱）${weak}、明亮（中）${medium}、长明（强）${strong}`,
  );

  if (profile.weakSpots.length > 0) {
    lines.push(
      `- 记忆薄弱（久未复习，已读但保持率 <40%）：${profile.weakSpots.map((w) => `《${w.title}》`).join('、')}`,
    );
  }
  lines.push(`- 阅读行为：近 7 天阅读 ${profile.reading.events7d} 次，累计 ${fmtMinutes(profile.reading.totalReadingMs)}`);

  if (profile.recentNotes.length > 0) {
    const notes = profile.recentNotes
      .slice(0, 3)
      .map((n) => {
        const body = n.note ?? n.quote ?? '';
        return `《${n.segmentTitle}》：「${body.slice(0, 40)}」`;
      })
      .join('；');
    lines.push(`- 最近的标注/笔记：${notes}`);
  }
  if (profile.hubs.length > 0) {
    lines.push(`- 关联枢纽（度数最高）：${profile.hubs.map((h) => `《${h.title}》(${h.degree})`).join('、')}`);
  }
  if (declaration?.trim()) {
    lines.push(`- 学习者自述：${declaration.trim().slice(0, 200)}`);
  }
  return lines.join('\n');
}

/** 60s TTL 缓存：导入/拆解逐段调用时避免重复画像 SQL（画像在短窗口内视为不变） */
let cachedProfile: { at: number; value: LearnerProfile | null } | null = null;

export async function deriveLearnerProfileCached(ttlMs = 60_000): Promise<LearnerProfile | null> {
  if (cachedProfile && Date.now() - cachedProfile.at < ttlMs) return cachedProfile.value;
  const value = await deriveLearnerProfile().catch(() => null);
  cachedProfile = { at: Date.now(), value };
  return value;
}

/** 测试钩子：清空 TTL 缓存 */
export function resetProfileCache(): void {
  cachedProfile = null;
}
