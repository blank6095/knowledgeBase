/**
 * 轻量 RAG 检索层（无向量库、零依赖）：
 * 查询分词（英数词 + 中文 2-3 字滑窗）→ SQL 候选（title/content ILIKE ∪ 标签等值重叠）
 * → 纯函数评分（命中关键词数×3 + 命中标签数×2）→ 排序取 topK；
 * neighborsOf 走 links 1-hop（wiki×2 + tag×1 + doc×1 加权累加）。
 */
import { arrayOverlaps, ilike, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { links, segments } from '@/db/schema';

export interface RagHit {
  segmentId: string;
  title: string;
  /** 渲染近似文本前 120 字 */
  snippet: string;
  score: number;
}

export interface ScoreInput {
  title: string;
  content: string;
  tags: string[];
}

/** 查询分词：英数词（≥2 位）原样 + 中文段 2-3 字滑窗，去重，上限 24 个防候选条件爆炸 */
export function tokenize(query: string): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    if (t && !out.includes(t)) out.push(t);
  };
  for (const m of query.toLowerCase().matchAll(/[a-z0-9][a-z0-9_-]+/g)) push(m[0]);
  for (const m of query.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const seg = m[0];
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) push(seg.slice(i, i + n));
    }
  }
  return out.slice(0, 24);
}

/**
 * 纯函数评分：命中关键词数×3 + 命中标签数×2。
 * 关键词命中 = token 为 title/content 的子串（不区分大小写）；
 * 标签命中 = token 与任一标签互相包含。
 */
export function scoreSegment(
  tokens: string[],
  seg: ScoreInput,
): { score: number; keywordHits: number; tagHits: number } {
  const title = seg.title.toLowerCase();
  const content = seg.content.toLowerCase();
  const tags = seg.tags.map((t) => t.toLowerCase());
  let keywordHits = 0;
  let tagHits = 0;
  for (const t of tokens) {
    if (title.includes(t) || content.includes(t)) keywordHits++;
    if (tags.some((tag) => tag.includes(t) || t.includes(tag))) tagHits++;
  }
  return { score: keywordHits * 3 + tagHits * 2, keywordHits, tagHits };
}

const SNIPPET_LEN = 120;
/** 摘要优先：有 LLM 摘要取摘要，否则回落渲染近似文本前 120 字 */
const toSnippet = (content: string, summary?: string | null) =>
  summary?.trim() ? summary.trim().slice(0, SNIPPET_LEN) : content.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);

/** 关键词检索：SQL 候选（ILIKE ∪ 标签等值重叠）→ 评分排序取 topK */
export async function retrieveByQuery(query: string, topK = 6): Promise<RagHit[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const probe = tokens.slice(0, 8);
  const candidates = await db
    .select({ id: segments.id, title: segments.title, content: segments.content, tags: segments.tags, summary: segments.summary })
    .from(segments)
    .where(
      or(
        ...probe.flatMap((t) => [ilike(segments.title, `%${t}%`), ilike(segments.content, `%${t}%`)]),
        arrayOverlaps(segments.tags, tokens),
      ),
    )
    .limit(200);

  return candidates
    .map((c) => {
      const { score } = scoreSegment(tokens, { title: c.title, content: c.content, tags: c.tags });
      return { segmentId: c.id, title: c.title, snippet: toSnippet(c.content, c.summary), score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

const KIND_WEIGHT: Record<string, number> = { wiki: 2, tag: 1, doc: 1 };

/** 1-hop 图谱邻居：links 加权累加（wiki×2 + tag×1 + doc×1），排除选中集自身，按分排序取 topK */
export async function neighborsOf(segmentIds: string | string[], topK = 5): Promise<RagHit[]> {
  const ids = Array.isArray(segmentIds) ? segmentIds : [segmentIds];
  if (ids.length === 0) return [];

  const edges = await db
    .select({ fromId: links.fromId, toId: links.toId, kind: links.kind })
    .from(links)
    .where(or(inArray(links.fromId, ids), inArray(links.toId, ids)));

  const score = new Map<string, number>();
  for (const e of edges) {
    const other = ids.includes(e.fromId) ? e.toId : e.fromId;
    if (ids.includes(other)) continue;
    score.set(other, (score.get(other) ?? 0) + (KIND_WEIGHT[e.kind] ?? 1));
  }
  const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
  if (top.length === 0) return [];

  const rows = await db
    .select({ id: segments.id, title: segments.title, content: segments.content, summary: segments.summary })
    .from(segments)
    .where(inArray(segments.id, top.map(([id]) => id)));
  const byId = new Map(rows.map((r) => [r.id, r] as const));

  return top
    .filter(([id]) => byId.has(id))
    .map(([id, sc]) => {
      const r = byId.get(id)!;
      return { segmentId: id, title: r.title, snippet: toSnippet(r.content, r.summary), score: sc };
    });
}
