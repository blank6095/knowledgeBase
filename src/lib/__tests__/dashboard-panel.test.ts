import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardPage from '@/app/page';
import MemoryBadge, { LampDot, MEMORY_TIER_META } from '@/components/MemoryBadge';
import DashboardPanel, {
  DashboardShell,
  DashboardSkeleton,
  DashboardView,
  EmptyLibrary,
  PageHeader,
  RecentSection,
  StatsBand,
  TodayCard,
  UnreadSection,
  WeakSection,
  subscribeStats,
  type RecentDocument,
  type StatsPayload,
  type UnreadSegment,
  type WeakSegment,
} from '@/components/DashboardPanel';

/**
 * 概览面板的渲染级用例（纯服务端渲染，无需 DOM）。
 * 覆盖四块行动、两处空态兜底、降权统计带与掌握度点色编码。
 */

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const WEAK: WeakSegment[] = [
  { segmentId: 's1', title: 'TCP 与 UDP', memory: 0.17, degree: 6 },
  { segmentId: 's2', title: 'OSI 七层模型', memory: 0.13, degree: 5 },
];

const UNREAD: UnreadSegment[] = [
  {
    segmentId: 'u1',
    title: '请求对象通配符',
    documentId: 'd1',
    documentTitle: '管道',
    createdAt: '2026-10-25T06:52:26.411Z',
  },
];

const RECENT: RecentDocument[] = [
  { id: 'd1', title: '管道', segmentCount: 4, createdAt: '2026-10-25T06:52:26.411Z' },
];

const FULL: StatsPayload = {
  total: 15,
  byTier: { unread: 4, weak: 11, medium: 0, strong: 0 },
  readToday: 2,
  recentDocuments: RECENT,
  suggestion: WEAK[0],
  weakTop3: WEAK,
  unreadTop3: UNREAD,
};

describe('掌握度徽章：四档点色', () => {
  it('每一档都渲染对应档位色，且带同色光晕', () => {
    const cases: [number, string][] = [
      [0, MEMORY_TIER_META.unread.dot],
      [0.2, MEMORY_TIER_META.weak.dot],
      [0.5, MEMORY_TIER_META.medium.dot],
      [0.9, MEMORY_TIER_META.strong.dot],
    ];
    for (const [memory, dot] of cases) {
      const html = render(createElement(MemoryBadge, { memory }));
      expect(html).toContain(dot);
      expect(html).toContain('box-shadow');
    }
  });

  it('带 title 时可访问（role=img），不带 title 时为纯装饰', () => {
    const withTitle = render(createElement(LampDot, { memory: 0.2, title: '微光' }));
    expect(withTitle).toContain('role="img"');
    expect(withTitle).toContain('aria-label="记忆程度：微光"');
    const bare = render(createElement(LampDot, { memory: 0.2 }));
    expect(bare).toContain('aria-hidden');
  });

  it('色值仍然来自 MEMORY_TIER_DOTS（未被改动）', () => {
    expect(MEMORY_TIER_META).toEqual({
      unread: { label: '未读', dot: '#55504a' },
      weak: { label: '微光', dot: '#8a6a33' },
      medium: { label: '明亮', dot: '#c49144' },
      strong: { label: '长明', dot: '#f2c069' },
    });
  });
});

describe('概览面板各区块', () => {
  it('页头：标题 + 导入入口', () => {
    const html = render(createElement(PageHeader));
    expect(html).toContain('概览');
    expect(html).toContain('导入知识');
    expect(html).toContain('href="/import"');
  });

  it('空库：只给引导导入', () => {
    const html = render(createElement(EmptyLibrary));
    expect(html).toContain('一盏灯都还没点亮。');
    expect(html).toContain('导入一篇 Markdown');
    expect(html).toContain('href="/import"');
  });

  it('今日先看：整卡可点，含百分比与关联数', () => {
    const html = render(createElement(TodayCard, { segment: WEAK[0] }));
    expect(html).toContain('今日先看');
    expect(html).toContain('TCP 与 UDP');
    expect(html).toContain('记忆 17%');
    expect(html).toContain('关联 6');
    expect(html).toContain('href="/segments/s1"');
    expect(html).toContain('border-l-2');
  });

  it('薄弱清单：每行灯点 + 标题 + 跳转；空数组时给一行兜底', () => {
    const filled = render(createElement(WeakSection, { items: WEAK }));
    expect(filled).toContain('薄弱清单');
    expect(filled).toContain('按遗忘风险 × 关联度排序');
    expect(filled).toContain('href="/segments/s1"');
    expect(filled).toContain('href="/segments/s2"');
    expect(filled).toContain('17%');
    expect(filled).toContain(MEMORY_TIER_META.weak.dot);

    const empty = render(createElement(WeakSection, { items: [] }));
    expect(empty).toContain('暂无薄弱项（已读且未到明亮档）');
    expect(empty).not.toContain('<li');
  });

  it('未读精选：未读档点 + 段标题 + 文档名；空数组时给一行兜底', () => {
    const filled = render(createElement(UnreadSection, { items: UNREAD }));
    expect(filled).toContain('未读精选');
    expect(filled).toContain('请求对象通配符');
    expect(filled).toContain('管道');
    expect(filled).toContain('href="/segments/u1"');
    expect(filled).toContain(MEMORY_TIER_META.unread.dot);

    const empty = render(createElement(UnreadSection, { items: [] }));
    expect(empty).toContain('没有未读段落了');
  });

  it('最近导入：文档标题可点，空数组时给一行兜底', () => {
    const filled = render(createElement(RecentSection, { documents: RECENT }));
    expect(filled).toContain('最近导入');
    expect(filled).toContain('href="/notes/d1"');
    expect(filled).toContain('查看全部 →');
    expect(filled).toContain('个知识点');

    const empty = render(createElement(RecentSection, { documents: [] }));
    expect(empty).toContain('暂无文档');
  });

  it('统计带：降权数字 + 图谱入口；长明档用 accent 强调', () => {
    const html = render(createElement(StatsBand, { total: 15, unread: 4, strong: 0, readToday: 2 }));
    expect(html).toContain('知识点总数');
    expect(html).toContain('未读');
    expect(html).toContain('长明');
    expect(html).toContain('今日阅读');
    expect(html).toContain('href="/graph"');
    expect(html).toContain('在图谱中查看掌握分布 →');
    expect(html).toContain('text-accent');
    // 降权：不再使用 hero 级字号
    expect(html).not.toContain('text-hero');
  });

  it('骨架屏：带加载语义', () => {
    const html = render(createElement(DashboardSkeleton));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="加载中"');
    expect(html).toContain('skeleton');
  });
});

describe('数据就绪后的行动面板', () => {
  it('自上而下：今日先看 → 薄弱清单 → 未读精选 → 最近导入 → 统计带', () => {
    const html = render(createElement(DashboardView, { stats: FULL }));
    const order = ['今日先看', '薄弱清单', '未读精选', '最近导入', '知识点总数'];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('每块行动都可点击达目标页面', () => {
    const html = render(createElement(DashboardView, { stats: FULL }));
    expect(html).toContain('href="/segments/s1"');
    expect(html).toContain('href="/segments/s2"');
    expect(html).toContain('href="/segments/u1"');
    expect(html).toContain('href="/notes/d1"');
    expect(html).toContain('href="/graph"');
  });

  it('不出现亮度渐变与四色分布条', () => {
    const html = render(createElement(DashboardView, { stats: FULL }));
    expect(html).not.toContain('linear-gradient');
    expect(html).not.toContain('hsl(38');
    // 分布条用百分比宽度表达占比，此处不应存在
    expect(html).not.toContain('width:');
  });

  it('空库：只渲染引导卡，不渲染任何行动区块与统计带', () => {
    const emptyStats: StatsPayload = { total: 0, byTier: {}, readToday: 0, recentDocuments: [], weakTop3: [], unreadTop3: [] };
    const html = render(createElement(DashboardView, { stats: emptyStats }));
    expect(html).toContain('一盏灯都还没点亮。');
    for (const absent of ['今日先看', '薄弱清单', '未读精选', '最近导入', '知识点总数']) {
      expect(html).not.toContain(absent);
    }
  });

  it('全部已读且无薄弱项：各区块显示一行兜底而非空卡', () => {
    const allStrong: StatsPayload = {
      total: 3,
      byTier: { unread: 0, weak: 0, medium: 0, strong: 3 },
      readToday: 1,
      recentDocuments: RECENT,
      suggestion: null,
      weakTop3: [],
      unreadTop3: [],
    };
    const html = render(createElement(DashboardView, { stats: allStrong }));
    expect(html).toContain('暂无薄弱项（已读且未到明亮档）');
    expect(html).toContain('没有未读段落了');
    expect(html).not.toContain('今日先看');
    expect(html).toContain('长明');
  });

  it('仅导入未读时：薄弱清单兜底文案不与未读状态矛盾，未读精选仍列出', () => {
    const unreadOnly: StatsPayload = {
      total: 2,
      byTier: { unread: 2, weak: 0, medium: 0, strong: 0 },
      readToday: 0,
      recentDocuments: RECENT,
      suggestion: null,
      weakTop3: [],
      unreadTop3: UNREAD,
    };
    const html = render(createElement(DashboardView, { stats: unreadOnly }));
    expect(html).toContain('暂无薄弱项（已读且未到明亮档）');
    expect(html).not.toContain('都在明亮以上');
    expect(html).toContain('未读精选');
    expect(html).toContain('请求对象通配符');
  });
});

describe('面板挂载', () => {
  it('首次渲染先给骨架屏（无数据时不出现行动区块）', () => {
    const html = render(createElement(DashboardPanel));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('今日先看');
  });

  it('页面入口挂载同下面板', () => {
    const html = render(createElement(DashboardPage));
    expect(html).toContain('role="status"');
  });

  it('外壳三态：错误提示 / 加载骨架 / 行动面板', () => {
    const errorHtml = render(createElement(DashboardShell, { stats: null, error: '未登录' }));
    expect(errorHtml).toContain('未登录');
    expect(errorHtml).toContain('text-danger');

    const loadingHtml = render(createElement(DashboardShell, { stats: null, error: '' }));
    expect(loadingHtml).toContain('role="status"');

    const readyHtml = render(createElement(DashboardShell, { stats: FULL, error: '' }));
    expect(readyHtml).toContain('今日先看');
  });
});

describe('统计订阅（成功 / 失败 / 卸载清理）', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const stubFetch = (impl: () => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(impl));
  };

  it('成功后把统计数据交给界面', async () => {
    stubFetch(async () => new Response(JSON.stringify(FULL), { status: 200 }));
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeStats(onData, onError);
    await flush();
    expect(onData).toHaveBeenCalledWith(FULL);
    expect(onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('失败后把错误信息交给界面', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: '未登录' }), { status: 401 }));
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeStats(onData, onError);
    await flush();
    expect(onError).toHaveBeenCalledWith('未登录');
    expect(onData).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('卸载后到达的响应被丢弃，不再回调', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const onData = vi.fn();
    const unsubscribe = subscribeStats(onData, vi.fn());
    unsubscribe();
    resolveFetch(new Response(JSON.stringify(FULL), { status: 200 }));
    await flush();
    expect(onData).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
