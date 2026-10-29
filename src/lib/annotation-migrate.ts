/**
 * 标注迁移（LLM 拆解/聚合 apply 的消费方，不改锚定机制）：
 * 把若干源段的标注迁到目标段——stripMarkdown 后的渲染文本交给 locate() 三级降级，
 * 首个命中的候选段即新归属；全部不命中则落到 fallback 段并置无效
 * （quote 保留不删，前端渲染时 locate 失败自动灰显）。
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { annotations } from '@/db/schema';
import { locate, type Anchor } from '@/lib/annotations';
import { runBatch } from '@/lib/db-batch';

export interface MigrateResult {
  /** 成功定位迁移的标注数（含无引文的节级笔记） */
  migrated: number;
  /** 未命中候选文本、落入 fallback 段置无效的标注数 */
  invalid: number;
}

interface AnnotationRow {
  id: string;
  segmentId: string;
  quote: string | null;
  occurrence: number;
  prefix: string | null;
  suffix: string | null;
}

export interface AnnotationMigrationPlan extends MigrateResult {
  updates: { id: string; segmentId: string; updatedAt: Date }[];
}

export function planAnnotationMigration(rows: AnnotationRow[], opts: {
  fromSegmentIds: string[];
  candidates: { segmentId: string; text: string }[];
  fallbackSegmentId: string;
}): AnnotationMigrationPlan {
  const { candidates, fallbackSegmentId } = opts;
  let migrated = 0;
  let invalid = 0;
  const updates: AnnotationMigrationPlan['updates'] = [];
  const updatedAt = new Date();

  for (const a of rows) {
    let target: string;
    let ok: boolean;
    if (a.quote) {
      const anchor: Anchor = { quote: a.quote, occurrence: a.occurrence, prefix: a.prefix, suffix: a.suffix };
      const hit = candidates.find((c) => locate(anchor, c.text) !== null);
      target = hit ? hit.segmentId : fallbackSegmentId;
      ok = Boolean(hit);
    } else {
      // 节级笔记（无引文）：内容归属跟随，直接落到兜底段
      target = fallbackSegmentId;
      ok = true;
    }
    if (target !== a.segmentId) {
      updates.push({ id: a.id, segmentId: target, updatedAt });
    }
    if (ok) migrated++;
    else invalid++;
  }
  return { migrated, invalid, updates };
}

export async function migrateAnnotations(opts: {
  fromSegmentIds: string[];
  /** 候选目标段（新文本），按优先级排序 */
  candidates: { segmentId: string; text: string }[];
  /** 全部不命中时的兜底段 */
  fallbackSegmentId: string;
}): Promise<MigrateResult> {
  if (opts.fromSegmentIds.length === 0) return { migrated: 0, invalid: 0 };
  const rows = await db.select().from(annotations).where(inArray(annotations.segmentId, opts.fromSegmentIds));
  const plan = planAnnotationMigration(rows, opts);
  await runBatch(
    plan.updates.map((update) =>
      db
        .update(annotations)
        .set({ segmentId: update.segmentId, updatedAt: update.updatedAt })
        .where(eq(annotations.id, update.id)),
    ),
  );
  return { migrated: plan.migrated, invalid: plan.invalid };
}
