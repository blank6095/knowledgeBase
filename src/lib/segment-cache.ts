/**
 * 段详情缓存（独立于统一读缓存 @/lib/cache）。
 *
 * 为什么不复用统一缓存：它的容量只有 64 条，是留给 graph/stats/docs 这类
 * 聚合视图的；段详情按 id 逐条缓存，会把那些聚合条目挤掉（一次浏览几十个段
 * 就能让图谱缓存失效），故另起一份存储。
 *
 * 失效粒度：段内容或链接一变，邻段的 refs（出/入链、上一/下一节）也会变，
 * 逐条失效容易漏，故采用整体清空——写入都是低频操作，代价可接受。
 */

/** 边（与 payload.links 同形） */
export interface SegmentEdge {
  fromId: string;
  toId: string;
  kind: string;
  weight: number;
}

/** 边对端段的展示所需字段 */
export interface SegmentNeighbor {
  id: string;
  title: string;
  stability: number;
  lastViewedAt: Date | null;
  orderIndex: number;
  documentId: string;
}

/**
 * 缓存的是原始行而不是最终响应体：记忆度按时间衰减，若把算好的 memory 存进缓存，
 * 灯点会被冻结在写入时刻，故只缓存可复算的原始字段。
 */
export interface SegmentRaw {
  seg: {
    id: string;
    title: string;
    content: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    firstViewedAt: Date | null;
    lastViewedAt: Date | null;
    stability: number;
    readingMs: number;
    summary: string | null;
    documentId: string;
    orderIndex: number;
  };
  document: { id: string; title: string } | null;
  edges: SegmentEdge[];
  neighbors: SegmentNeighbor[];
}

/** 段内会被阅读行为改写的字段（view 上报后回写缓存，避免计数滞后） */
export interface SegmentPatch {
  viewCount?: number;
  firstViewedAt?: Date | null;
  lastViewedAt?: Date | null;
  stability?: number;
  readingMs?: number;
  summary?: string | null;
}

/** 缓存条目：写入时间 + 值 */
import { setWithCapacity } from '@/lib/ttl-store';

interface Entry {
  at: number;
  value: SegmentRaw;
}

/** 容量上限：超出后按插入顺序淘汰最旧条目 */
const MAX_ENTRIES = 64;

/**
 * 新鲜期。段详情读多写少，但阅读行为（viewCount/stability/readingMs）会改写段内计数，
 * 故窗口取短；记忆度不缓存，读取时现算，衰减不受缓存影响。
 */
export const SEGMENT_CACHE_TTL_MS = 30_000;

/**
 * 陈旧快照保留时长：新鲜期过后仍保留，用于数据库瞬时不可用时降级返回
 * （宁可给 slightly old 的数据，也不要整页报错）。
 */
const STALE_TTL_MS = 15 * 60_000;

const store = new Map<string, Entry>();

/** 读取新鲜缓存：过期视为未命中（条目保留，供降级用） */
export function getSegmentCache(id: string): SegmentRaw | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= SEGMENT_CACHE_TTL_MS) return undefined;
  return entry.value;
}

/** 读取陈旧快照（降级用）：新鲜期已过但仍在保留期内 */
export function getStaleSegmentCache(id: string): SegmentRaw | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= STALE_TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return entry.value;
}

/** 写入缓存：覆盖已有 id 不占新增容量，仅刷新写入时间与位置 */
export function setSegmentCache(id: string, value: SegmentRaw): void {
  setWithCapacity(store, id, { at: Date.now(), value }, MAX_ENTRIES);
}

/**
 * 回写段内计数：阅读上报会改写 viewCount/stability/readingMs，
 * 若只依赖 TTL 失效，刷新详情时看到的仍是旧计数。
 */
export function patchSegmentCache(id: string, patch: SegmentPatch): void {
  const entry = store.get(id);
  if (!entry) return;
  entry.value.seg = { ...entry.value.seg, ...patch };
  entry.at = Date.now();
}

/** 失效：整体清空（内容或链接变更会波及邻段的引用，故不做单条失效） */
export function invalidateSegmentCaches(): void {
  store.clear();
}
