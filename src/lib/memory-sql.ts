/**
 * 记忆度的 SQL 表达式（服务端专用）。
 *
 * 为什么独立于 src/lib/memory.ts：
 * - memory.ts 是「纯 TS 记忆模型」，被客户端组件（灯点、配色）直接引用，不能引入 Drizzle；
 * - 本模块只做 SQL 片段拼装，仅供服务端（API Route Handler / 数据服务层）使用。
 *
 * 与 memory.ts memoryOf() 的关系：
 * 记忆度 M(t) = exp(-Δt天 / S)，其中 S 为稳定度（天），Δt 为距最近一次有效阅读的天数。
 * 两者口径必须一致——本模块把公式收敛到一处，避免各调用点各写一份、参数悄悄漂移。
 *
 * 档位阈值统一取自 memory.ts 的 TIER_THRESHOLDS（weak < medium < strong）：
 * - unread：从未有效阅读（stability <= 0 或 lastViewedAt 为空）
 * - weak  ：0 < M < TIER_THRESHOLDS.medium
 * - medium：TIER_THRESHOLDS.medium <= M < TIER_THRESHOLDS.strong
 * - strong：M >= TIER_THRESHOLDS.strong
 */
import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { segments } from '@/db/schema';
import { TIER_THRESHOLDS } from '@/lib/memory';

/**
 * 稳定度下限：防止除零。
 * 取 1e-9 而非更大的值，使「极小但非零的稳定度」仍按原值参与计算，
 * 与 memory.ts 中 `stability <= 0` 判 0 的口径严格对应。
 */
const STABILITY_FLOOR = '1e-9';

/** 稳定度下限的字面量 SQL 片段（用于 greatest() 的第二个参数） */
const stabilityFloor = () => sql.raw(STABILITY_FLOOR);

/**
 * 记忆度 SQL 表达式（不做空值保护）：
 * exp(-extract(epoch from (now() - lastViewedAt)) / 86400.0 / greatest(stability, 1e-9))
 *
 * 调用方需自行保证 lastViewedAt 非空且 stability > 0（即先与 isRead 条件组合使用）；
 * 若需要「未读即 0」的语义，请改用 safeMemory()。
 */
export function memory(
  stability: AnyColumn = segments.stability,
  lastViewedAt: AnyColumn = segments.lastViewedAt,
): SQL {
  return sql`exp(-extract(epoch from (now() - ${lastViewedAt})) / 86400.0 / greatest(${stability}, ${stabilityFloor()}))`;
}

/**
 * 记忆度 SQL 表达式（带未读保护）：
 * stability <= 0 或 lastViewedAt 为空时返回 0，否则同 memory()。
 */
export function safeMemory(
  stability: AnyColumn = segments.stability,
  lastViewedAt: AnyColumn = segments.lastViewedAt,
): SQL {
  return sql`case when ${stability} <= 0 or ${lastViewedAt} is null then 0 else ${memory(stability, lastViewedAt)} end`;
}

/**
 * 「已有效阅读」判定：stability > 0 且 lastViewedAt 非空。
 * 与 memory.ts memoryOf() 返回 0 的条件一致（从未有效阅读即未读）。
 */
export function isRead(
  stability: AnyColumn = segments.stability,
  lastViewedAt: AnyColumn = segments.lastViewedAt,
): SQL {
  return sql`${stability} > 0 and ${lastViewedAt} is not null`;
}

/** 薄弱阈值（SQL 字面量）：M < TIER_THRESHOLDS.medium */
export function weakLimit(): SQL {
  return sql.raw(String(TIER_THRESHOLDS.medium));
}

/** 长明阈值（SQL 字面量）：M >= TIER_THRESHOLDS.strong */
export function strongLimit(): SQL {
  return sql.raw(String(TIER_THRESHOLDS.strong));
}
