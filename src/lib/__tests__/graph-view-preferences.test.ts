import { describe, expect, it } from 'vitest';
import { KINDS, DEFAULT_FORCES } from '@/lib/graph/graph-state';
import { MEMORY_TIER_ORDER } from '@/lib/memory';
import {
  DEFAULT_GRAPH_VIEW_PREFERENCES,
  GRAPH_VIEW_PREFERENCES_KEY,
  GRAPH_VIEW_PREFERENCES_VERSION,
  getGraphViewPreferencesSnapshot,
  loadGraphViewPreferences,
  normalizeGraphViewPreferences,
  parseGraphViewPreferences,
  resetGraphViewPreferences,
  saveGraphViewPreferences,
  updateGraphViewPreferences,
} from '@/lib/graph/graph-preferences';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  let key: string | null = null;
  return {
    getItem: () => value,
    setItem: (nextKey: string, next: string) => {
      key = nextKey;
      value = next;
    },
    read: () => value,
    readKey: () => key,
  };
}

describe('graph-view-preferences 默认值与解析（UX-29）', () => {
  it('默认勾选全部记忆程度与关联类型，其余字段与画布初始状态一致', () => {
    expect(DEFAULT_GRAPH_VIEW_PREFERENCES).toEqual({
      version: GRAPH_VIEW_PREFERENCES_VERSION,
      tierOn: Object.fromEntries(MEMORY_TIER_ORDER.map((tier) => [tier, true])),
      kindOn: Object.fromEntries(KINDS.map((kind) => [kind.kind, true])),
      groups: [],
      arrows: false,
      fadeThreshold: 1.2,
      sizeMult: 1,
      linkWidthMult: 1,
      forces: { ...DEFAULT_FORCES },
    });
  });

  it('无值/空串/损坏 JSON/版本不符都回默认', () => {
    expect(parseGraphViewPreferences(null)).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parseGraphViewPreferences('')).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parseGraphViewPreferences('{oops')).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parseGraphViewPreferences('null')).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parseGraphViewPreferences('[]')).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parseGraphViewPreferences(JSON.stringify({ version: 2, arrows: true }))).toEqual(
      DEFAULT_GRAPH_VIEW_PREFERENCES,
    );
  });

  it('向后兼容：旧数据缺少字段时逐项回默认值', () => {
    const parsed = parseGraphViewPreferences(JSON.stringify({ version: 1 }));
    expect(parsed).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(parsed.tierOn).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES.tierOn);
    expect(parsed.forces).toEqual(DEFAULT_FORCES);
  });

  it('合法字段保留，非法字段降级，数值 clamp 到滑杆区间', () => {
    const parsed = parseGraphViewPreferences(
      JSON.stringify({
        version: 1,
        tierOn: { unread: false, weak: 'yes' },
        kindOn: { wiki: false },
        arrows: true,
        fadeThreshold: 99,
        sizeMult: 0.1,
        linkWidthMult: 9,
        forces: { center: -1, charge: 999, linkStrength: 'x', linkDistance: 4 },
      }),
    );
    expect(parsed.tierOn).toEqual({ unread: false, weak: true, medium: true, strong: true });
    expect(parsed.kindOn).toEqual({ wiki: false, tag: true, doc: true });
    expect(parsed.arrows).toBe(true);
    expect(parsed.fadeThreshold).toBe(3);
    expect(parsed.sizeMult).toBe(0.5);
    expect(parsed.linkWidthMult).toBe(4);
    expect(parsed.forces).toEqual({ center: 0, charge: 300, linkStrength: 1, linkDistance: 10 });
  });

  it('分组：校验类型与颜色，id 冲突时重新编号，最多 20 条；编辑中的空关键词保留', () => {
    const parsed = normalizeGraphViewPreferences({
      version: 1,
      groups: [
        { id: 3, query: '索引', color: '#E8B04B' },
        { id: 3, query: '缓存', color: '#5cc8e6' },
        { id: 4, query: '   ', color: '#5cc8e6' },
        { id: 5, query: '无效颜色', color: 'red' },
        { id: 6, query: '非对象颜色', color: 123 },
        { id: 7, query: 42, color: '#5cc8e6' },
        'oops',
      ],
    });
    expect(parsed.groups).toEqual([
      { id: 3, query: '索引', color: '#E8B04B' },
      // id 冲突 → 回落到最小的未占用 id
      { id: 1, query: '缓存', color: '#5cc8e6' },
      // 用户清空输入框重输时不能丢行（空关键词不命中任何节点）
      { id: 4, query: '   ', color: '#5cc8e6' },
    ]);

    const many = normalizeGraphViewPreferences({
      version: 1,
      groups: Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        query: `关键词${index}`,
        color: '#5cc8e6',
      })),
    });
    expect(many.groups).toHaveLength(20);
    expect(many.groups.map((group) => group.id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });
});

describe('graph-view-preferences 持久化（localStorage 安全）', () => {
  it('load/save 使用固定 key，落盘前归一化并可往返', () => {
    const storage = memoryStorage();
    const prefs = normalizeGraphViewPreferences({
      version: 1,
      arrows: true,
      tierOn: { unread: false },
      forces: { center: 1.5 },
    });
    saveGraphViewPreferences(prefs, storage);
    expect(storage.readKey()).toBe(GRAPH_VIEW_PREFERENCES_KEY);
    expect(loadGraphViewPreferences(storage)).toEqual(prefs);
    expect(JSON.parse(storage.read() ?? '{}').version).toBe(1);
  });

  it('storage 抛错（隐私模式/禁用）时静默回默认且不崩', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadGraphViewPreferences(throwing)).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(() => saveGraphViewPreferences(DEFAULT_GRAPH_VIEW_PREFERENCES, throwing)).not.toThrow();
  });

  it('无 window / 显式传 null storage 时一律用默认值（SSR 安全）', () => {
    expect(loadGraphViewPreferences(null)).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
  });

  it('外部 store：update 合并 patch 并更新快照，reset 回默认', () => {
    resetGraphViewPreferences();
    const next = updateGraphViewPreferences({ arrows: true, fadeThreshold: 2 });
    expect(next.arrows).toBe(true);
    expect(next.fadeThreshold).toBe(2);
    expect(next.tierOn).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES.tierOn);
    expect(getGraphViewPreferencesSnapshot()).toBe(next);

    const reset = resetGraphViewPreferences();
    expect(reset).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
    expect(getGraphViewPreferencesSnapshot()).toEqual(DEFAULT_GRAPH_VIEW_PREFERENCES);
  });
});
