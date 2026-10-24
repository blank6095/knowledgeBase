import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  real,
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
 * 知识点：文档分割后的最小复习单元。
 * 观测字段（view*）记录查看行为，SM-2 字段（ease/intervalDays/reps/lapses/dueAt）
 * 驱动间隔重复，mastery/status 是派生的掌握程度。
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

    // 查看行为
    viewCount: integer('view_count').notNull().default(0),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),

    // SM-2 间隔重复状态
    ease: real('ease').notNull().default(2.5),
    intervalDays: real('interval_days').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastGrade: integer('last_grade'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),

    // 掌握程度（由复习结果派生，0~1）
    mastery: real('mastery').notNull().default(0),
    status: text('status').notNull().default('new'), // new | learning | familiar | mastered

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('segments_document_idx').on(t.documentId),
    index('segments_due_idx').on(t.dueAt),
  ],
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

/** 复习记录 */
export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    grade: integer('grade').notNull(), // 0 忘记 1 困难 2 良好 3 简单
    prevIntervalDays: real('prev_interval_days').notNull().default(0),
    nextIntervalDays: real('next_interval_days').notNull().default(0),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_logs_segment_idx').on(t.segmentId)],
);
