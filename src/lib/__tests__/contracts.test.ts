import { describe, expect, it } from 'vitest';
import type {
  DocsPayload,
  DocsRow,
  NoteDetailPayload,
  NoteSegment,
  RecentDocument,
  SegmentDetailPayload,
  StatsPayload,
  UnreadSegment,
  WeakSegment,
} from '@/lib/contracts';

/**
 * API 契约的形状守卫。
 *
 * 背景：同一个响应体过去在服务端 Route Handler 与客户端组件各写一份 interface，
 * 字段可选性与精度会悄悄漂移（/api/stats 的 tierOrder 只在服务端存在，
 * byTier 在客户端被写成 Record<string, number>）。
 * 契约收敛到 @/lib/contracts 后，这里把「客户端依赖的字段」钉死：
 * 契约里删掉/改名/改成可选，编译期即报错，而不是等到线上某个页面白屏。
 *
 * 本文件不连数据库，只断言类型层的约定；运行期行为由各路由的路由级用例覆盖。
 */
describe('contracts：前后端共享契约', () => {
  it('StatsPayload 的必选字段齐全（服务端实际返回这些字段）', () => {
    const stats: StatsPayload = {
      total: 15,
      byTier: { unread: 4, weak: 11, medium: 0, strong: 0 },
      tierOrder: ['unread', 'weak', 'medium', 'strong'],
      readToday: 2,
      recentDocuments: [
        { id: 'd1', title: '管道', segmentCount: 4, createdAt: '2026-10-25T06:52:26.411Z' },
      ],
      suggestion: { segmentId: 's1', title: 'TCP 与 UDP', memory: 0.17, degree: 6 },
      weakTop3: [{ segmentId: 's1', title: 'TCP 与 UDP', memory: 0.17, degree: 6 }],
      unreadTop3: [
        {
          segmentId: 'u1',
          title: '请求对象通配符',
          documentId: 'd1',
          documentTitle: '管道',
          createdAt: '2026-10-25T06:52:26.411Z',
        },
      ],
    };
    expect(stats.tierOrder).toHaveLength(4);
    expect(Object.keys(stats.byTier)).toEqual(['unread', 'weak', 'medium', 'strong']);
  });

  it('日期字段是 ISO 字符串（JSON 序列化后的形态，非 Date 对象）', () => {
    const doc: RecentDocument = {
      id: 'd1',
      title: '管道',
      segmentCount: 4,
      createdAt: '2026-10-25T06:52:26.411Z',
    };
    expect(typeof doc.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(doc.createdAt))).toBe(false);
  });

  it('DocsPayload 的每一行都带 avgMemory', () => {
    const row: DocsRow = {
      id: 'd1',
      title: '管道',
      source: 'paste',
      tags: ['网络'],
      segmentCount: 4,
      createdAt: '2026-10-25T06:52:26.411Z',
      avgMemory: 0.42,
    };
    const payload: DocsPayload = { documents: [row] };
    expect(payload.documents[0].avgMemory).toBe(0.42);
  });

  it('NoteDetailPayload 的 document 与 segments 形状固定', () => {
    const segment: NoteSegment = {
      id: 's1',
      title: 'TCP 与 UDP',
      headingPath: '基础篇 > 网络',
      tags: ['网络'],
      viewCount: 3,
      content: '正文',
      memory: 0.42,
    };
    const payload: NoteDetailPayload = {
      document: {
        id: 'd1',
        title: '管道',
        tags: ['网络'],
        segmentCount: 1,
        createdAt: '2026-10-25T06:52:26.411Z',
        storageKey: null,
      },
      segments: [segment],
    };
    expect(payload.segments[0].memory).toBe(0.42);
    expect(payload.document.storageKey).toBeNull();
  });

  it('SegmentDetailPayload 的 refs 五个键都存在（出链/入链/上一节/下一节/共同标签）', () => {
    const payload: SegmentDetailPayload = {
      segment: {
        id: 's1',
        title: 'TCP 与 UDP',
        content: '正文',
        headingPath: '基础篇 > 网络',
        tags: ['网络'],
        viewCount: 3,
        firstViewedAt: '2026-10-25T06:52:26.411Z',
        lastViewedAt: '2026-10-25T06:52:26.411Z',
        stability: 0.8,
        readingMs: 180000,
        memory: 0.42,
        summary: null,
      },
      document: { id: 'd1', title: '管道' },
      links: [{ fromId: 's1', toId: 's2', kind: 'wiki', weight: 1 }],
      refs: {
        outgoing: [{ id: 's2', title: 'OSI 七层模型', memory: 0.3 }],
        incoming: [],
        prev: null,
        next: null,
        relatedTags: [],
      },
    };
    expect(Object.keys(payload.refs).sort()).toEqual([
      'incoming',
      'next',
      'outgoing',
      'prev',
      'relatedTags',
    ]);
  });

  it('WeakSegment / UnreadSegment 是可复用的展示模型', () => {
    const weak: WeakSegment = { segmentId: 's1', title: 'TCP 与 UDP', memory: 0.17, degree: 6 };
    const unread: UnreadSegment = {
      segmentId: 'u1',
      title: '请求对象通配符',
      documentId: 'd1',
      documentTitle: '管道',
      createdAt: '2026-10-25T06:52:26.411Z',
    };
    expect(weak.degree).toBe(6);
    expect(unread.documentTitle).toBe('管道');
  });
});
