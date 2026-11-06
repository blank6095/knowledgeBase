import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  isConsistentState,
  reduceUniverseState,
  type UniverseState,
} from '@/lib/graph/universe/state';

describe('universe 两层状态机', () => {
  it('初始状态为自由探索且自洽', () => {
    const state = createInitialState();
    expect(state.mode).toBe('explore');
    expect(state.context.selectedNodeId).toBeNull();
    expect(isConsistentState(state)).toBe(true);
  });

  it('五种主模式互斥，进入新模式时保留独立上下文', () => {
    let state: UniverseState = reduceUniverseState(createInitialState(), {
      type: 'set-query',
      query: '机器学习',
      matchedIds: ['n1', 'n2'],
    });
    expect(state.mode).toBe('search');

    state = reduceUniverseState(state, { type: 'select-node', id: 'n1' });
    expect(state.mode, '点击节点不得把主模式改成「节点选中」').toBe('search');
    expect(state.context.selectedNodeId).toBe('n1');
    expect(state.context.query).toBe('机器学习');

    state = reduceUniverseState(state, { type: 'enter-mode', mode: 'ai' });
    expect(state.mode, '切换主模式不得清空搜索上下文').toBe('ai');
    expect(state.context.query).toBe('机器学习');
    expect(state.context.selectedNodeId, '切换主模式不得丢失选中节点').toBe('n1');
    expect(state.context.overlay, '切换主模式不得丢失浮层状态').toBe('detail');
  });

  it('进入学习模式保存视角，退出后回到进入前主模式', () => {
    const searched = reduceUniverseState(createInitialState(), {
      type: 'set-query',
      query: '索引',
      matchedIds: ['n1'],
    });
    const learning = reduceUniverseState(searched, {
      type: 'enter-mode',
      mode: 'learning',
      viewport: { x: 10, y: 20, zoom: 1.5 },
    });
    expect(learning.context.savedViewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    const exited = reduceUniverseState(learning, { type: 'exit-mode' });
    expect(exited.mode).toBe(learning.previousMode);
    expect(exited.context.query).toBe('索引');
  });

  it('独立上下文互不覆盖', () => {
    let state = reduceUniverseState(createInitialState(), { type: 'set-path', from: 'a', to: 'b' });
    state = reduceUniverseState(state, { type: 'set-query', query: '图谱', matchedIds: ['a'] });
    expect(state.context.pathEndpoints).toEqual(['a', 'b']);
    state = reduceUniverseState(state, { type: 'clear-selection' });
    expect(state.context.query).toBe('图谱');
  });

  it('无变化返回原引用，便于跳过重绘', () => {
    const state = createInitialState();
    expect(reduceUniverseState(state, { type: 'enter-mode', mode: 'explore' })).toBe(state);
    expect(reduceUniverseState(state, { type: 'clear-selection' })).toBe(state);
  });

  it('清除查询回到进入前模式并清空搜索上下文', () => {
    const searched = reduceUniverseState(createInitialState(), {
      type: 'set-query',
      query: 'TCP',
      matchedIds: ['n1'],
    });
    const cleared = reduceUniverseState(searched, { type: 'clear-query' });
    expect(cleared.mode).toBe('explore');
    expect(cleared.context.query).toBe('');
    expect(cleared.context.matchedIds).toHaveLength(0);
    expect(isConsistentState(cleared)).toBe(true);
  });

  it('reset 回到初始状态', () => {
    const modified = reduceUniverseState(createInitialState(), { type: 'select-node', id: 'x' });
    expect(reduceUniverseState(modified, { type: 'reset' })).toEqual(createInitialState());
  });
});
