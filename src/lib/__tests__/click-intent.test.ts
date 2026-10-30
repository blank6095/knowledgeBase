import { describe, expect, it } from 'vitest';
import {
  DOUBLE_CLICK_THRESHOLD_MS,
  isDoubleClick,
  nextClickRecord,
  type ClickRecord,
} from '@/lib/graph/click-intent';

describe('click-intent', () => {
  const t0 = 1_000;
  const first: ClickRecord = { id: 'a', at: t0 };

  it('无历史记录时不是双击', () => {
    expect(isDoubleClick(null, 'a', t0 + 100)).toBe(false);
    expect(isDoubleClick(undefined, 'a', t0 + 100)).toBe(false);
  });

  it('同节点阈值内（含边界）是双击', () => {
    expect(isDoubleClick(first, 'a', t0 + 1)).toBe(true);
    expect(isDoubleClick(first, 'a', t0 + DOUBLE_CLICK_THRESHOLD_MS)).toBe(true);
  });

  it('同节点超过阈值不是双击', () => {
    expect(isDoubleClick(first, 'a', t0 + DOUBLE_CLICK_THRESHOLD_MS + 1)).toBe(false);
  });

  it('不同节点不是双击', () => {
    expect(isDoubleClick(first, 'b', t0 + 50)).toBe(false);
  });

  it('时间倒退/同一时刻按单击处理（防御异常输入）', () => {
    expect(isDoubleClick(first, 'a', t0)).toBe(false);
    expect(isDoubleClick(first, 'a', t0 - 20)).toBe(false);
  });

  it('nextClickRecord：双击后清空，单击保留最新记录', () => {
    expect(nextClickRecord(first, 'a', t0 + 100)).toBeNull();
    expect(nextClickRecord(first, 'b', t0 + 100)).toEqual({ id: 'b', at: t0 + 100 });
    expect(nextClickRecord(null, 'a', t0)).toEqual({ id: 'a', at: t0 });
  });
});
