/**
 * 图谱前端搜索索引与匹配算法（U2-1）。
 *
 * 约束（建议 §三·3 铁律）：
 * - 只产出视图状态（命中集合 + 结果列表），不修改 nodes / links；
 * - 索引在 nodes 变更时重建一次，输入时只做匹配；
 * - 纯函数、无 DOM/React 依赖，可直接单测。
 *
 * 匹配字段与优先级：标题完全相等 > 标题 startsWith > 标题 includes > 标签 >
 * headingPath > 摘要。fixture 节点缺少 tags/summary/headingPath 时按空处理。
 */
import type { GraphNode } from './graph-types';

export type SearchReason = 'title' | 'tags' | 'summary' | 'headingPath';

export interface SearchEntry {
  id: string;
  title: string;
  titleLower: string;
  tagsLower: string[];
  summaryLower: string;
  headingPathLower: string;
  node: GraphNode;
}

export interface GraphSearchIndex {
  entries: SearchEntry[];
  byId: Map<string, SearchEntry>;
}

export interface SearchHit {
  id: string;
  title: string;
  reason: SearchReason;
  /** 命中字段的可读片段（如命中的标签名），无则不填 */
  detail?: string;
  /** 排序分：越大越靠前（标题精确 100 → 摘要 50） */
  score: number;
}

const REASON_LABEL: Record<SearchReason, string> = {
  title: '标题',
  tags: '标签',
  summary: '摘要',
  headingPath: '路径',
};

export function reasonLabel(reason: SearchReason): string {
  return REASON_LABEL[reason];
}

const RANK = {
  titleExact: 100,
  titlePrefix: 90,
  titleIncludes: 80,
  tagExact: 70,
  tagIncludes: 65,
  headingPath: 60,
  summary: 50,
} as const;

const EMPTY_INDEX: GraphSearchIndex = { entries: [], byId: new Map() };

/** 建索引：预计算小写字段，节点变更时调用一次。 */
export function buildSearchIndex(nodes: readonly GraphNode[]): GraphSearchIndex {
  if (!nodes || nodes.length === 0) return EMPTY_INDEX;
  const entries: SearchEntry[] = nodes.map((node) => {
    const tags = Array.isArray(node.tags) ? node.tags : [];
    return {
      id: node.id,
      title: node.title,
      titleLower: (node.title ?? '').toLowerCase(),
      tagsLower: tags.map((tag) => String(tag).toLowerCase()),
      summaryLower: (node.summary ?? '').toLowerCase(),
      headingPathLower: (node.headingPath ?? '').toLowerCase(),
      node,
    };
  });
  return { entries, byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

interface Candidate {
  entry: SearchEntry;
  reason: SearchReason;
  detail?: string;
  score: number;
}

function bestMatch(entry: SearchEntry, q: string): Candidate | null {
  if (entry.titleLower === q) return { entry, reason: 'title', score: RANK.titleExact };
  if (entry.titleLower.startsWith(q)) return { entry, reason: 'title', score: RANK.titlePrefix };
  if (entry.titleLower.includes(q)) return { entry, reason: 'title', score: RANK.titleIncludes };

  let best: Candidate | null = null;
  for (const tag of entry.tagsLower) {
    if (tag === q && (!best || RANK.tagExact > best.score)) {
      best = { entry, reason: 'tags', detail: tag, score: RANK.tagExact };
    } else if (tag.includes(q) && (!best || RANK.tagIncludes > best.score)) {
      best = { entry, reason: 'tags', detail: tag, score: RANK.tagIncludes };
    }
  }
  if (best) return best;

  if (entry.headingPathLower.includes(q)) {
    return { entry, reason: 'headingPath', score: RANK.headingPath };
  }
  if (entry.summaryLower.includes(q)) {
    return { entry, reason: 'summary', score: RANK.summary };
  }
  return null;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 全部命中节点（不受 limit 截断），用于画布视觉状态 */
  matchedIds: Set<string>;
}

/**
 * 搜索：大小写不敏感，最多返回 limit 条结果；matchedIds 含全部命中节点。
 * 空/纯空白查询返回空结果（不改变视图）。
 */
export function searchGraph(index: GraphSearchIndex, query: string, limit = 8): SearchResult {
  const q = query.trim().toLowerCase();
  if (!q || index.entries.length === 0) {
    return { hits: [], matchedIds: new Set() };
  }

  const candidates: Candidate[] = [];
  for (const entry of index.entries) {
    const candidate = bestMatch(entry, q);
    if (candidate) candidates.push(candidate);
  }

  const matchedIds = new Set(candidates.map((candidate) => candidate.entry.id));
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byTitle = a.entry.title.localeCompare(b.entry.title, 'zh-Hans-CN');
    if (byTitle !== 0) return byTitle;
    return a.entry.id.localeCompare(b.entry.id);
  });

  const hits: SearchHit[] = candidates.slice(0, Math.max(0, limit)).map((candidate) => ({
    id: candidate.entry.id,
    title: candidate.entry.title,
    reason: candidate.reason,
    detail: candidate.detail,
    score: candidate.score,
  }));

  return { hits, matchedIds };
}
