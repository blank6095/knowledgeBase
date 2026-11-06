import { describe, expect, it } from 'vitest';
import { createUniverseEngine, type UniverseNodeInput } from '@/lib/graph/universe/engine';
import { SpatialHash } from '@/lib/graph/universe/spatial-index';
import { createTokens } from '@/lib/graph/universe/tokens';
import type { Viewport } from '@/lib/graph/universe/renderer';

function makeNode(id: string, x: number, degree = 2): UniverseNodeInput {
  return {
    id,
    x,
    y: 0,
    radius: 6,
    degree,
    title: `知识点 ${id}`,
    memory: 0.7,
    viewCount: 5,
    readingMs: 12_000,
    documentTitle: '测试文档',
  };
}

const viewport: Viewport = {
  width: 800,
  height: 600,
  dpr: 1,
  centerX: 0,
  centerY: 0,
  zoom: 1,
};

describe('空间索引', () => {
  it('命中最近节点且忽略越界坐标', () => {
    const index = new SpatialHash<UniverseNodeInput>(64);
    index.rebuild([makeNode('a', 0), makeNode('b', 200)]);
    expect(index.size).toBe(2);
    expect(index.hitTest(3, 0)?.id).toBe('a');
    expect(index.hitTest(203, 0)?.id).toBe('b');
    expect(index.hitTest(100, 0, 2)).toBeNull();
  });

  it('矩形查询返回相交节点并去重', () => {
    const index = new SpatialHash<UniverseNodeInput>(32);
    index.rebuild([makeNode('a', 0), makeNode('b', 100), makeNode('c', 400)]);
    const ids = index.query({ x: -10, y: -10, width: 130, height: 20 }).map((n) => n.id);
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));
  });

  it('非法 cellSize 快速失败', () => {
    expect(() => new SpatialHash(0)).toThrow(/cellSize/);
  });
});

describe('内核编排', () => {
  it('构建确定性绘制指令并做视口裁剪', () => {
    const engine = createUniverseEngine();
    engine.setGraph(
      [makeNode('a', 0), makeNode('b', 100), makeNode('far', 100_000)],
      [{ source: 'a', target: 'b', kind: 'wiki' }],
    );
    engine.setViewport(viewport);
    const first = engine.buildFrame(0);
    const second = engine.buildFrame(0);
    expect(first, '相同签名应复用缓存的绘制指令').toBe(second);
    expect(first.visibleNodes).toBe(2);
    expect(first.culledNodes).toBe(1);
    expect(first.commands[0]?.kind).toBe('background');
  });

  it('选中节点只更新独立上下文，且不改变亮度语义', () => {
    const engine = createUniverseEngine();
    engine.setGraph([makeNode('a', 0)], []);
    engine.setViewport(viewport);
    const before = engine.getFacts('a');
    engine.dispatch({ type: 'set-query', query: '知识点', matchedIds: [] });
    engine.dispatch({ type: 'select-node', id: 'a' });
    expect(engine.getState().mode).toBe('search');
    expect(engine.getState().context.selectedNodeId).toBe('a');
    const after = engine.getFacts('a');
    expect(after?.memory).toBe(before?.memory);
    const list = engine.buildFrame(1);
    const nodeCommand = list.commands.find((command) => command.kind === 'node');
    expect(nodeCommand?.kind).toBe('node');
    if (nodeCommand?.kind === 'node') expect(nodeCommand.paint.halo).toBe(true);
  });

  it('DEC-01 保持 pending，注入评审结论后通道随之切换且无需改内核', () => {
    const engine = createUniverseEngine();
    engine.setGraph(
      [makeNode('a', 0)],
      [],
      [{ segmentId: 'a', reasonCode: 'due-review', latestResult: 'correct', nextReviewAt: null }],
    );
    expect(engine.getTokens().decisionPolicy).toBe('pending');
    expect(engine.getPendingChannels()).toEqual(['masteryRing', 'dueMarker']);
    expect(engine.getFacts('a')?.masteryEvidence).toBeNull();

    engine.setTokens({ decisionPolicy: 'keep' });
    expect(engine.getPendingChannels()).toHaveLength(0);
    expect(engine.getFacts('a')?.masteryEvidence).toBe(true);
    expect(engine.getFacts('a')?.dueMarker).toBe(true);

    engine.setTokens({ decisionPolicy: 'remove' });
    expect(engine.getFacts('a')?.masteryEvidence).toBe(false);
    expect(engine.getFacts('a')?.dueMarker).toBe(false);
  });

  it('viewport 非法输入快速失败，destroy 后状态复位', () => {
    const engine = createUniverseEngine();
    expect(() => engine.setViewport({ ...viewport, width: -1 })).toThrow(/viewport/);
    engine.setGraph([makeNode('a', 0)], []);
    engine.dispatch({ type: 'select-node', id: 'a' });
    engine.destroy();
    expect(engine.getState().mode).toBe('explore');
    expect(engine.getFacts('a')).toBeUndefined();
  });

  it('令牌不可变且默认值可复现', () => {
    const a = createTokens();
    const b = createTokens();
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.node)).toBe(true);
  });
});
