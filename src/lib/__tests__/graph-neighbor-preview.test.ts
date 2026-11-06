import { describe, expect, it } from 'vitest';
import {
  NEIGHBOR_PREVIEW_LIMIT,
  previewNeighbors,
} from '@/lib/graph/graph-neighbor-preview';

const makeNeighbors = (count: number): { id: string }[] =>
  Array.from({ length: count }, (_, index) => ({ id: `n-${index + 1}` }));

describe('previewNeighbors（UX-12 关联全量可达）', () => {
  it('默认最多预览 8 条，且超出部分计入 hidden', () => {
    const preview = previewNeighbors(makeNeighbors(12), false);
    expect(preview.visible).toHaveLength(NEIGHBOR_PREVIEW_LIMIT);
    expect(preview.hidden).toBe(4);
    expect(preview.total).toBe(12);
    expect(preview.hasMore).toBe(true);
  });

  it('展开后渲染全量，hidden 归零，仍保留 hasMore 供「收起」按钮显示', () => {
    const preview = previewNeighbors(makeNeighbors(12), true);
    expect(preview.visible).toHaveLength(12);
    expect(preview.visible.at(-1)).toEqual({ id: 'n-12' });
    expect(preview.hidden).toBe(0);
    expect(preview.hasMore).toBe(true);
  });

  it('恰好 8 条 / 少于 8 条不需要展开按钮', () => {
    for (const count of [0, 1, 8]) {
      const preview = previewNeighbors(makeNeighbors(count), false);
      expect(preview.visible).toHaveLength(count);
      expect(preview.hidden).toBe(0);
      expect(preview.hasMore).toBe(false);
    }
  });

  it('limit 可覆盖，空列表与非法 limit 都安全', () => {
    expect(previewNeighbors(makeNeighbors(5), false, 2).visible).toHaveLength(2);
    expect(previewNeighbors(makeNeighbors(5), false, 2).hidden).toBe(3);
    expect(previewNeighbors([], false).visible).toEqual([]);
    expect(previewNeighbors(makeNeighbors(9), false, Number.NaN).visible).toHaveLength(
      NEIGHBOR_PREVIEW_LIMIT,
    );
    expect(previewNeighbors(makeNeighbors(9), false, -3).visible).toEqual([]);
  });
});
