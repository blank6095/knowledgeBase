import { describe, expect, it } from 'vitest';
import { computeLinkPaints, type LinkPaintContext } from '@/lib/graph/graph-state';
import { KINDS } from '@/lib/graph/graph-state';
import type { GraphLink } from '@/lib/graph/graph-types';

const link = (source: string, target: string, kind = 'wiki', weight = 1): GraphLink => ({
  source,
  target,
  kind,
  weight,
});

const baseCtx: LinkPaintContext = {
  matchedIds: null,
  neighborIds: null,
  pathEdgeKeys: null,
  hoverSet: null,
  hoverId: null,
  focusIds: null,
  linkWidthMult: 1,
};

describe('computeLinkPaints：连线绘制参数预计算', () => {
  it('无交互态时输出各关系类型的基础色与权重宽度', () => {
    const a = link('a', 'b', 'wiki', 1);
    const b = link('b', 'c', 'tag', 0.8);
    const paints = computeLinkPaints([a, b], baseCtx);

    expect(paints.get(a)).toEqual({ color: KINDS[0].color, width: 1 });
    expect(paints.get(b)).toEqual({ color: KINDS[1].color, width: Math.max(0.5, 0.8) });
  });

  it('悬停端点时宽度 ×1.8', () => {
    const l = link('a', 'b');
    const paints = computeLinkPaints([l], { ...baseCtx, hoverId: 'a' });
    expect(paints.get(l)?.width).toBeCloseTo(1.8, 5);
  });

  it('浮层搜索：两端命中走路径提亮色 + 1.8× 宽度；无关边压暗', () => {
    const hit = link('a', 'b');
    const unrelated = link('c', 'd');
    const paints = computeLinkPaints([hit, unrelated], {
      ...baseCtx,
      matchedIds: new Set(['a', 'b']),
      neighborIds: new Set(),
    });

    expect(paints.get(hit)?.color).not.toBe(KINDS[0].color); // 命中路径提亮
    expect(paints.get(hit)?.width).toBeCloseTo(1.8, 5);
    expect(paints.get(unrelated)?.color).toBe(`${KINDS[0].color}20`); // 压暗
    expect(paints.get(unrelated)?.width).toBe(1);
  });

  it('双节点路径边宽度 ×2.2，其余边压暗', () => {
    const onPath = link('a', 'b');
    const offPath = link('c', 'd');
    const paints = computeLinkPaints([onPath, offPath], {
      ...baseCtx,
      pathEdgeKeys: new Set(['a|b']),
    });

    expect(paints.get(onPath)?.width).toBeCloseTo(2.2, 5);
    expect(paints.get(offPath)?.color).toBe(`${KINDS[0].color}20`);
  });

  it('聚焦集合外的边压暗（聚焦优先于悬停）', () => {
    const inFocus = link('a', 'b');
    const outFocus = link('c', 'd');
    const paints = computeLinkPaints([inFocus, outFocus], {
      ...baseCtx,
      hoverId: 'c',
      focusIds: new Set(['a', 'b']),
    });

    expect(paints.get(outFocus)?.color).toBe(`${KINDS[0].color}20`);
    expect(paints.get(inFocus)?.color).toBe(KINDS[0].color);
  });

  it('按 linkWidthMult 缩放宽度', () => {
    const l = link('a', 'b', 'wiki', 1);
    const paints = computeLinkPaints([l], { ...baseCtx, linkWidthMult: 2 });
    expect(paints.get(l)?.width).toBe(2);
  });

  it('以边对象引用为键：同一对象重复计算结果稳定', () => {
    const l = link('a', 'b');
    const first = computeLinkPaints([l], baseCtx);
    const second = computeLinkPaints([l], baseCtx);
    expect(first.get(l)).toEqual(second.get(l));
    expect(first.size).toBe(1);
  });
});
