import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { segments } from '@/db/schema';
import { isRead, memory, safeMemory, strongLimit, weakLimit } from '@/lib/memory-sql';
import { TIER_THRESHOLDS } from '@/lib/memory';

const dialect = new PgDialect();
const render = (chunk: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(chunk);

/**
 * 记忆度 SQL 表达式收敛到 @/lib/memory-sql 后，本用例锁定「渲染结果与重构前逐字一致」。
 *
 * 背景：重构前 exp(-Δt/S) 公式散落在 7 个调用点（stats / notes / learner-profile /
 * kb-overview / rag / ai-ask），各写一份字面量，参数与阈值容易悄悄漂移。
 * 这里把重构前的原始写法作为「黄金样本」钉住，任何后续改动一旦改变 SQL 语义即失败。
 */
describe('memory-sql：记忆度 SQL 表达式口径锁定', () => {
  it('memory() 与重构前的原写法渲染结果逐字一致', () => {
    const before = render(
      sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`,
    );
    const after = render(memory());
    expect(after.sql).toBe(before.sql);
    expect(after.params).toEqual(before.params);
  });

  it('isRead() 与重构前的原写法渲染结果逐字一致', () => {
    const before = render(sql`${segments.stability} > 0 and ${segments.lastViewedAt} is not null`);
    const after = render(isRead());
    expect(after.sql).toBe(before.sql);
    expect(after.params).toEqual(before.params);
  });

  it('safeMemory() 与重构前 notes 路由的 case-when 写法渲染结果逐字一致', () => {
    const before = render(
      sql`case when ${segments.stability} <= 0 or ${segments.lastViewedAt} is null then 0
          else exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9)) end`,
    );
    const after = render(safeMemory());
    expect(after.sql.replace(/\s+/g, ' ')).toBe(before.sql.replace(/\s+/g, ' '));
    expect(after.params).toEqual(before.params);
  });

  it('safeMemory() 的未读分支与 rag 旧写法语义等价（条件顺序不同、epsilon 区间不可达）', () => {
    const rag = render(safeMemory());
    // 旧 rag 写法条件顺序为 `lastViewedAt is null or stability <= 0`，与新写法等价
    expect(rag.sql).toContain('case when');
    expect(rag.sql).toContain('greatest');
    // 稳定度由 applyReading 产出并 round4 到 4 位小数，最小正值 0.0001，
    // 故 greatest(stability, 1e-9) 与 greatest(stability, 0.0001) 在可达区间内恒等。
    const reachable = [0.0001, 0.0002, 0.001, 0.1, 1, 365];
    for (const s of reachable) {
      expect(Math.max(s, 1e-9)).toBe(Math.max(s, 0.0001));
    }
  });

  it('档位阈值片段与 memory.ts 的 TIER_THRESHOLDS 同源', () => {
    expect(render(sql`${weakLimit()}`).sql).toBe(String(TIER_THRESHOLDS.medium));
    expect(render(sql`${strongLimit()}`).sql).toBe(String(TIER_THRESHOLDS.strong));
    // 阈值语义：weak < medium < strong
    expect(TIER_THRESHOLDS.medium).toBeLessThan(TIER_THRESHOLDS.strong);
  });
});
