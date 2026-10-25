import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/** 导入的知识文档（一个 .md 文件或一段粘贴内容） */
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  source: text('source').notNull().default('paste'), // paste | file
  filename: text('filename'),
  storageKey: text('storage_key'), // R2 对象键，未配置 R2 时为空
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  segmentCount: integer('segment_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 知识点：文档分割后的最小学习单元。
 * 观测字段记录阅读行为：stability 是记忆曲线的稳定度（天），
 * readingMs 是累计有效阅读毫秒数；记忆度由 src/lib/memory.ts 在读取时现算，不落库。
 */
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    headingPath: text('heading_path').notNull().default(''), // 如 "基础篇 > 索引原理"
    orderIndex: integer('order_index').notNull().default(0),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),

    // 阅读行为
    viewCount: integer('view_count').notNull().default(0),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    stability: real('stability').notNull().default(0), // 记忆稳定度（天），0=从未有效阅读
    readingMs: bigint('reading_ms', { mode: 'number' }).notNull().default(0), // 累计有效阅读毫秒

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('segments_document_idx').on(t.documentId)],
);

/** 知识点之间的关联边 */
export const links = pgTable(
  'links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // wiki（[[双链]]） | tag（共同标签） | doc（同文档相邻）
    weight: real('weight').notNull().default(1),
  },
  (t) => [uniqueIndex('links_unique').on(t.fromId, t.toId, t.kind)],
);

/** 有效阅读事件流水（单次停留 ≥5 秒才写入，由 view 路由上报） */
export const readingEvents = pgTable(
  'reading_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [index('reading_events_segment_idx').on(t.segmentId), index('reading_events_started_idx').on(t.startedAt)],
);
