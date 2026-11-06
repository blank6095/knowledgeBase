import { describe, expect, it } from 'vitest';
import {
  filterEmptyHint,
  isFilteredEmpty,
  summarizeGraphFilter,
} from '@/lib/graph/graph-filter-empty';

describe('summarizeGraphFilter（UX-28 筛选空态判定）', () => {
  it('原始节点为 0 → no-data（引导导入）', () => {
    expect(summarizeGraphFilter(0, 0)).toEqual({ total: 0, visible: 0, hidden: 0, status: 'no-data' });
  });

  it('有数据但筛选后为 0 → filtered-empty（引导重置筛选）', () => {
    expect(summarizeGraphFilter(12, 0)).toEqual({
      total: 12,
      visible: 0,
      hidden: 12,
      status: 'filtered-empty',
    });
    expect(isFilteredEmpty(12, 0)).toBe(true);
  });

  it('部分可见 → ready，hidden = total - visible', () => {
    expect(summarizeGraphFilter(12, 5)).toEqual({ total: 12, visible: 5, hidden: 7, status: 'ready' });
    expect(isFilteredEmpty(12, 5)).toBe(false);
  });

  it('全部可见 → ready 且 hidden 为 0', () => {
    expect(summarizeGraphFilter(12, 12)).toEqual({ total: 12, visible: 12, hidden: 0, status: 'ready' });
  });

  it('防御脏输入：负数 / NaN / 小数 / visible > total', () => {
    expect(summarizeGraphFilter(-3, -1)).toEqual({ total: 0, visible: 0, hidden: 0, status: 'no-data' });
    expect(summarizeGraphFilter(Number.NaN, Number.NaN)).toEqual({
      total: 0,
      visible: 0,
      hidden: 0,
      status: 'no-data',
    });
    // 小数向下取整；可见数不允许超过原始节点数
    expect(summarizeGraphFilter(12.9, 3.7)).toEqual({
      total: 12,
      visible: 3,
      hidden: 9,
      status: 'ready',
    });
    expect(summarizeGraphFilter(4, 99).visible).toBe(4);
    expect(summarizeGraphFilter(4, 99).hidden).toBe(0);
  });

  it('filterEmptyHint 给出隐藏数量文案', () => {
    expect(filterEmptyHint(12, 0)).toBe('已隐藏 12 个知识点');
    expect(filterEmptyHint(12, 5)).toBe('已隐藏 7 个知识点');
  });
});
