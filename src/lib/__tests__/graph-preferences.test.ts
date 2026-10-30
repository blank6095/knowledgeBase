import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_PREFERENCES,
  GRAPH_PREFERENCES_KEY,
  loadGraphPreferences,
  parseGraphPreferences,
  saveGraphPreferences,
} from '@/lib/graph/graph-preferences';
import { GRAPH_ENVIRONMENTS, GRAPH_NODE_STYLES, isGraphEnvironmentId, isGraphNodeStyleId } from '@/lib/graph/graph-theme';

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

describe('graph-theme 定义表', () => {
  it('4 套冷色环境 + 4 种节点风格，id 唯一且字段完整', () => {
    expect(GRAPH_ENVIRONMENTS).toHaveLength(4);
    expect(GRAPH_NODE_STYLES).toHaveLength(4);
    expect(new Set(GRAPH_ENVIRONMENTS.map((e) => e.id)).size).toBe(4);
    expect(new Set(GRAPH_NODE_STYLES.map((s) => s.id)).size).toBe(4);
    for (const env of GRAPH_ENVIRONMENTS) {
      expect(env.label.length).toBeGreaterThan(0);
      expect(env.description.length).toBeGreaterThan(0);
      expect(env.swatches).toHaveLength(3);
      for (const color of env.swatches) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const style of GRAPH_NODE_STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
    }
  });

  it('id 判定只接受白名单', () => {
    expect(isGraphEnvironmentId('aurora')).toBe(true);
    expect(isGraphEnvironmentId('warm-library')).toBe(false);
    expect(isGraphEnvironmentId(1)).toBe(false);
    expect(isGraphNodeStyleId('crystal')).toBe(true);
    expect(isGraphNodeStyleId('unknown')).toBe(false);
  });

  it('默认偏好为冷色深空 + 光点 + 1× 强度', () => {
    expect(DEFAULT_GRAPH_PREFERENCES).toMatchObject({
      version: 1,
      environment: 'deep-space',
      nodeStyle: 'orb',
      glow: 1,
      background: 1,
    });
  });
});

describe('graph-preferences 解析/持久化', () => {
  it('无值/空串/损坏 JSON 回默认', () => {
    expect(parseGraphPreferences(null)).toEqual(DEFAULT_GRAPH_PREFERENCES);
    expect(parseGraphPreferences('')).toEqual(DEFAULT_GRAPH_PREFERENCES);
    expect(parseGraphPreferences('{oops')).toEqual(DEFAULT_GRAPH_PREFERENCES);
    expect(parseGraphPreferences('null')).toEqual(DEFAULT_GRAPH_PREFERENCES);
  });

  it('版本不匹配回默认', () => {
    const raw = JSON.stringify({ version: 2, environment: 'aurora', nodeStyle: 'wire', glow: 1.2, background: 1.1 });
    expect(parseGraphPreferences(raw)).toEqual(DEFAULT_GRAPH_PREFERENCES);
  });

  it('非法环境/风格 id 降级为默认，合法字段保留', () => {
    const raw = JSON.stringify({ version: 1, environment: 'nope', nodeStyle: 'crystal', glow: 1.2, background: 0.8 });
    expect(parseGraphPreferences(raw)).toEqual({
      version: 1,
      environment: 'deep-space',
      nodeStyle: 'crystal',
      glow: 1.2,
      background: 0.8,
    });
  });

  it('glow/background 越界 clamp 到区间', () => {
    const low = parseGraphPreferences(JSON.stringify({ version: 1, environment: 'minimal', nodeStyle: 'orb', glow: 0, background: 0 }));
    expect(low.glow).toBe(0.5);
    expect(low.background).toBe(0.4);
    const high = parseGraphPreferences(JSON.stringify({ version: 1, environment: 'digital', nodeStyle: 'energy', glow: 9, background: 9 }));
    expect(high.glow).toBe(1.8);
    expect(high.background).toBe(1.5);
    const bad = parseGraphPreferences(JSON.stringify({ version: 1, environment: 'aurora', nodeStyle: 'orb', glow: 'x', background: null }));
    expect(bad.glow).toBe(1);
    expect(bad.background).toBe(1);
  });

  it('load/save 使用固定 key 并可往返', () => {
    const storage = memoryStorage();
    const prefs = { ...DEFAULT_GRAPH_PREFERENCES, environment: 'aurora' as const, nodeStyle: 'wire' as const, glow: 1.4 };
    saveGraphPreferences(prefs, storage);
    expect(storage.readKey()).toBe(GRAPH_PREFERENCES_KEY);
    expect(loadGraphPreferences(storage)).toEqual(prefs);
  });

  it('storage 抛错（隐私模式/禁用）时静默回默认且不崩', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      clear: () => {
        throw new Error('blocked');
      },
      key: () => null,
      length: 0,
    } as unknown as Storage;
    expect(loadGraphPreferences(throwing)).toEqual(DEFAULT_GRAPH_PREFERENCES);
    expect(() => saveGraphPreferences(DEFAULT_GRAPH_PREFERENCES, throwing)).not.toThrow();
  });
});
