import { describe, expect, it } from 'vitest';
import { createVisualFacts, normalizeMemory, type GraphNodeRecord, type TodayLearningRecord } from '@/lib/graph/universe/data';
import { createTokens } from '@/lib/graph/universe/tokens';
import {
  encodeBrightness,
  encodeNode,
  encodeSearchOpacity,
  findChannelViolations,
} from '@/lib/graph/universe/visual';

const node: GraphNodeRecord = {
  id: 'n1',
  title: '数据库索引',
  memory: 0.9,
  viewCount: 120,
  readingMs: 900_000,
  documentTitle: '数据库笔记',
};

const realReview: TodayLearningRecord = {
  segmentId: 'n1',
  reasonCode: 'due-review',
  latestResult: 'correct',
  nextReviewAt: '2026-11-01T00:00:00.000Z',
};

const now = Date.parse('2026-11-04T00:00:00.000Z');
const tokens = createTokens();

describe('数据来源与 DEC-01 三态', () => {
  it('pending 是第三态：不产生信号，也不删除通道能力', () => {
    const facts = createVisualFacts(node, realReview, 'pending', now);
    expect(facts.masteryEvidence).toBeNull();
    expect(facts.dueMarker).toBeNull();
    expect(facts.pendingChannels).toEqual(['masteryRing', 'dueMarker']);
  });

  it('keep 时只有真实复习记录才构成掌握证据，不得由阅读行为推断', () => {
    const withReview = createVisualFacts(node, realReview, 'keep', now);
    expect(withReview.masteryEvidence).toBe(true);
    expect(withReview.dueMarker).toBe(true);

    const noReview = createVisualFacts(node, undefined, 'keep', now);
    expect(noReview.masteryEvidence, '高 viewCount / readingMs 不等于掌握').toBe(false);
    expect(noReview.dueMarker, '不得按记忆亮度猜测待复习').toBe(false);
  });

  it('remove 时两个通道明确关闭', () => {
    const facts = createVisualFacts(node, realReview, 'remove', now);
    expect(facts.masteryEvidence).toBe(false);
    expect(facts.dueMarker).toBe(false);
    expect(facts.pendingChannels).toHaveLength(0);
  });

  it('记忆度做防御性归一化', () => {
    expect(normalizeMemory(Number.NaN)).toBe(0);
    expect(normalizeMemory(-1)).toBe(0);
    expect(normalizeMemory(2)).toBe(1);
    expect(normalizeMemory(0.5)).toBe(0.5);
  });
});

describe('视觉通道唯一语义', () => {
  it('亮度只由记忆新鲜度决定，搜索不覆盖亮度', () => {
    const facts = createVisualFacts(node, undefined, 'pending', now);
    const bright = encodeNode(facts, { hasQuery: false, matched: false, selected: false, zoom: 1 }, tokens);
    const dimmedBySearch = encodeNode(facts, { hasQuery: true, matched: false, selected: false, zoom: 1 }, tokens);
    const matched = encodeNode(facts, { hasQuery: true, matched: true, selected: false, zoom: 1 }, tokens);

    expect(bright.brightness).toBe(encodeBrightness(0.9));
    expect(dimmedBySearch.brightness).toBe(bright.brightness);
    expect(matched.brightness).toBe(bright.brightness);
    expect(dimmedBySearch.opacity).toBe(tokens.search.dimOpacity);
    expect(matched.opacity).toBe(1);
  });

  it('编码函数单调且值域受限', () => {
    expect(encodeBrightness(0)).toBeLessThan(encodeBrightness(1));
    expect(encodeBrightness(1)).toBe(1);
    expect(encodeSearchOpacity({ hasQuery: false, matched: false, selected: false, zoom: 1 }, tokens)).toBe(1);
  });

  it('pending 不渲染 DEC-01 信号，选中态仍独立可用', () => {
    const facts = createVisualFacts(node, realReview, 'pending', now);
    const paint = encodeNode(facts, { hasQuery: false, matched: false, selected: true, zoom: 1 }, tokens);
    expect(paint.ring).toBeNull();
    expect(paint.marker).toBeNull();
    expect(paint.halo).toBe(true);
    expect(findChannelViolations(paint)).toHaveLength(0);
  });
});
