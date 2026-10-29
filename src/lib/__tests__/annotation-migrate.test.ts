import { describe, expect, it } from 'vitest';
import { planAnnotationMigration } from '../annotation-migrate';

const base = {
  segmentId: 'source',
  occurrence: 1,
  prefix: '',
  suffix: '',
};

describe('planAnnotationMigration', () => {
  it('把命中子段正文的标注迁到对应候选段', () => {
    const plan = planAnnotationMigration(
      [{ ...base, id: 'a1', quote: '第二个知识点' }, { ...base, id: 'a2', quote: '第一段正文' }],
      {
        fromSegmentIds: ['source'],
        candidates: [
          { segmentId: 'child-1', text: '第一段正文' },
          { segmentId: 'child-2', text: '第二个知识点' },
        ],
        fallbackSegmentId: 'child-1',
      },
    );
    expect(plan.migrated).toBe(2);
    expect(plan.invalid).toBe(0);
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: 'a1', segmentId: 'child-2' }),
      expect.objectContaining({ id: 'a2', segmentId: 'child-1' }),
    ]);
  });

  it('未命中引文落到兜底段并计入 invalid', () => {
    const plan = planAnnotationMigration(
      [{ ...base, segmentId: 'removed', id: 'a1', quote: '已经不存在的引文' }],
      {
        fromSegmentIds: ['removed'],
        candidates: [{ segmentId: 'keeper', text: '合并后的正文' }],
        fallbackSegmentId: 'keeper',
      },
    );
    expect(plan.migrated).toBe(0);
    expect(plan.invalid).toBe(1);
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: 'a1', segmentId: 'keeper' }),
    ]);
  });

  it('节级笔记直接跟随兜底段并视为有效迁移', () => {
    const plan = planAnnotationMigration(
      [{ ...base, segmentId: 'removed', id: 'n1', quote: null }],
      {
        fromSegmentIds: ['removed'],
        candidates: [{ segmentId: 'keeper', text: '正文' }],
        fallbackSegmentId: 'keeper',
      },
    );
    expect(plan.migrated).toBe(1);
    expect(plan.invalid).toBe(0);
  });
});
