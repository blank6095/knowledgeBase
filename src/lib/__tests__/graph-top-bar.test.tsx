import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GraphTopBar from '@/components/graph/GraphTopBar';

describe('GraphTopBar 搜索入口', () => {
  it('常规状态只渲染顶栏搜索入口', () => {
    const html = renderToStaticMarkup(
      createElement(GraphTopBar, { nodeCount: 15, edgeCount: 18 }),
    );
    expect(html).toContain('搜索知识（Ctrl K）');
  });

  it('图谱搜索浮层打开时移除重复的顶栏搜索框', () => {
    const html = renderToStaticMarkup(
      createElement(GraphTopBar, {
        nodeCount: 15,
        edgeCount: 18,
        searchOpen: true,
        searchOverlay: createElement('span', null, '搜索浮层'),
      }),
    );
    expect(html).not.toContain('搜索知识（Ctrl K）');
    expect(html).toContain('知识宇宙');
    expect(html).toContain('搜索浮层');
  });
});
