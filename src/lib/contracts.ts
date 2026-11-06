/**
 * 前后端共享的 API 契约（wire types）。
 *
 * 为什么集中在这里：
 * - 同一个响应体过去在服务端 Route Handler 与客户端组件各写一份 interface，
 *   字段可选性与精度会悄悄漂移（例如 /api/stats 的 tierOrder 与 byTier 精确键
 *   只在服务端存在，客户端写成了 Record<string, number> 与全可选字段）；
 * - 本模块只放**纯类型**，不含运行时值，因此既不会把 Drizzle / 服务端代码
 *   拖进客户端 bundle，也不影响任何运行时行为。
 *
 * 约定：
 * - 日期在 JSON 中序列化为 ISO 字符串，故此处一律用 string；
 * - 响应的「一定存在」的字段写必选，可选字段才用 `?`。
 */

/** 记忆档位（与 src/lib/memory.ts 的 MemoryTier 同源） */
export type MemoryTierName = 'unread' | 'weak' | 'medium' | 'strong';

/** 薄弱知识点（概览页用） */
export interface WeakSegment {
  segmentId: string;
  title: string;
  memory: number;
  degree: number;
}

/** 未读段落（概览页用） */
export interface UnreadSegment {
  segmentId: string;
  title: string;
  documentId: string;
  documentTitle: string;
  /** JSON 序列化后的 ISO 字符串 */
  createdAt: string;
}

/** 最近导入的文档摘要 */
export interface RecentDocument {
  id: string;
  title: string;
  segmentCount: number;
  /** JSON 序列化后的 ISO 字符串 */
  createdAt: string;
}

/** GET /api/stats */
export interface StatsPayload {
  total: number;
  byTier: Record<MemoryTierName, number>;
  tierOrder: MemoryTierName[];
  readToday: number;
  recentDocuments: RecentDocument[];
  suggestion: WeakSegment | null;
  /** 已读且记忆薄弱（m<0.4）按 薄弱度×(度数+1) 取 top3 */
  weakTop3: WeakSegment[];
  /** 最新导入且未读的段落 top3 */
  unreadTop3: UnreadSegment[];
}

/** GET /api/notes —— 文档列表行 */
export interface DocsRow {
  id: string;
  title: string;
  source: string;
  tags: string[];
  segmentCount: number;
  /** JSON 序列化后的 ISO 字符串 */
  createdAt: string;
  avgMemory: number;
}

/** GET /api/notes —— 响应体 */
export interface DocsPayload {
  documents: DocsRow[];
}

/** GET /api/notes/[id] —— 文档详情中的单个知识点 */
export interface NoteSegment {
  id: string;
  title: string;
  headingPath: string;
  tags: string[];
  viewCount: number;
  content: string;
  memory: number;
}

/** GET /api/notes/[id] —— 响应体 */
export interface NoteDetailPayload {
  document: {
    id: string;
    title: string;
    tags: string[];
    segmentCount: number;
    /** JSON 序列化后的 ISO 字符串 */
    createdAt: string;
    storageKey: string | null;
  };
  segments: NoteSegment[];
}

/** 知识点详情里的引用项（出链/入链/上一节/下一节/共同标签） */
export interface SegmentRefItem {
  id: string;
  title: string;
  memory: number;
}

/** GET /api/segments/[id] —— 响应体 */
export interface SegmentDetailPayload {
  segment: {
    id: string;
    title: string;
    content: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    /** JSON 序列化后的 ISO 字符串 */
    firstViewedAt: string | null;
    /** JSON 序列化后的 ISO 字符串 */
    lastViewedAt: string | null;
    stability: number;
    readingMs: number;
    memory: number;
    summary: string | null;
  };
  document: { id: string; title: string } | null;
  links: { fromId: string; toId: string; kind: string; weight: number }[];
  refs: {
    outgoing: SegmentRefItem[];
    incoming: SegmentRefItem[];
    prev: SegmentRefItem | null;
    next: SegmentRefItem | null;
    relatedTags: SegmentRefItem[];
  };
}
