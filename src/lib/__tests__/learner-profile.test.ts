import { describe, expect, it } from 'vitest';
import { profileToPromptBlock, type LearnerProfile } from '../learner-profile';

const FULL: LearnerProfile = {
  totalSegments: 18,
  tiers: { unread: 11, weak: 4, medium: 2, strong: 1 },
  weakSpots: [
    { segmentId: 'a', title: '字体布局偏移', memory: 0.21 },
    { segmentId: 'b', title: 'TCP 与 UDP', memory: 0.33 },
  ],
  reading: { events7d: 6, totalReadingMs: 3720000, lastReadAt: '2026-10-25T10:00:00Z' },
  recentNotes: [{ segmentTitle: '单线程', quote: null, note: 'Node 的事件循环要点' }],
  hubs: [
    { segmentId: 'c', title: 'TCP 与 UDP', degree: 5 },
    { segmentId: 'd', title: 'OSI 七层模型', degree: 3 },
  ],
};

describe('profileToPromptBlock（画像 → prompt 块纯函数）', () => {
  it('空库返回空串（不注入）', () => {
    expect(profileToPromptBlock(null)).toBe('');
    expect(
      profileToPromptBlock({ ...FULL, totalSegments: 0, tiers: { unread: 0, weak: 0, medium: 0, strong: 0 } }),
    ).toBe('');
  });

  it('完整画像：档位/薄弱/阅读/笔记/枢纽/自述全部落块', () => {
    const block = profileToPromptBlock(FULL, '目标：后端方向求职');
    expect(block).toContain('学习者画像');
    expect(block).toContain('未读 11、微光（弱）4、明亮（中）2、长明（强）1');
    expect(block).toContain('《字体布局偏移》');
    expect(block).toContain('《TCP 与 UDP》');
    expect(block).toContain('近 7 天阅读 6 次');
    expect(block).toContain('累计 1 小时 2 分');
    expect(block).toContain('「Node 的事件循环要点」');
    expect(block).toContain('《TCP 与 UDP》(5)');
    expect(block).toContain('学习者自述：目标：后端方向求职');
  });

  it('仅部分数据：缺失项不出现空行/空括号', () => {
    const minimal: LearnerProfile = {
      totalSegments: 1,
      tiers: { unread: 1, weak: 0, medium: 0, strong: 0 },
      weakSpots: [],
      reading: { events7d: 0, totalReadingMs: 0, lastReadAt: null },
      recentNotes: [],
      hubs: [],
    };
    const block = profileToPromptBlock(minimal, '');
    expect(block).toContain('未读 1、微光（弱）0');
    expect(block).not.toContain('记忆薄弱');
    expect(block).not.toContain('最近的标注');
    expect(block).not.toContain('关联枢纽');
    expect(block).not.toContain('学习者自述');
  });

  it('自述截断至 200 字', () => {
    const block = profileToPromptBlock(FULL, '长'.repeat(300));
    const line = block.split('\n').find((l) => l.includes('学习者自述'))!;
    expect(line.length).toBeLessThanOrEqual(210);
  });
});
