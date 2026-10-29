import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayLearningSection } from '@/components/TodayLearningPanel';

describe('TodayLearningSection', () => {
  it('展示推荐原因、直达链接与本周反馈', () => {
    const html = renderToStaticMarkup(
      createElement(TodayLearningSection, {
        learning: {
          items: [
            {
              segmentId: 's1',
              title: 'HashMap',
              documentId: 'd1',
              documentTitle: 'Java',
              memory: 0.3,
              viewCount: 2,
              lastViewedAt: null,
              createdAt: '2026-10-20T00:00:00.000Z',
              reasonCode: 'previous-incorrect',
              reason: '上次没有答出',
              latestResult: 'incorrect',
              nextReviewAt: null,
            },
          ],
          metrics: { reviewCount: 8, needsReviewCount: 2, improvedCount: 1, activeDays: 4 },
          generatedAt: '2026-10-29T00:00:00.000Z',
        },
      }),
    );
    expect(html).toContain('今日学习');
    expect(html).toContain('上次没有答出');
    expect(html).toContain('href="/study/s1"');
    expect(html).toContain('近 7 天自测');
    expect(html).toContain('>8<');
  });

  it('无推荐时仍给出继续学习入口', () => {
    const html = renderToStaticMarkup(
      createElement(TodayLearningSection, {
        learning: {
          items: [],
          metrics: { reviewCount: 0, needsReviewCount: 0, improvedCount: 0, activeDays: 0 },
          generatedAt: '2026-10-29T00:00:00.000Z',
        },
      }),
    );
    expect(html).toContain('今天没有必须复习的内容');
    expect(html).toContain('href="/notes"');
  });
});
