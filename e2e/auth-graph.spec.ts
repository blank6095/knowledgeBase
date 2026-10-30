import { expect, test } from '@playwright/test';

const PASSCODE = 'e2e-passcode';

test('未登录访问页面会进入登录页', async ({ page }) => {
  const response = await page.request.get('/login');
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await page.goto('/notes');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByPlaceholder('访问口令')).toBeVisible();
});

test('登录 next 参数不允许跳出当前站点（非法 next 回图谱）', async ({ page }) => {
  await page.route('**/api/stats', (route) =>
    route.fulfill({
      json: {
        total: 0,
        byTier: { unread: 0, weak: 0, medium: 0, strong: 0 },
        tierOrder: ['unread', 'weak', 'medium', 'strong'],
        readToday: 0,
        recentDocuments: [],
        suggestion: null,
        weakTop3: [],
        unreadTop3: [],
      },
    }),
  );
  await page.route('**/api/learning/today', (route) =>
    route.fulfill({
      json: {
        items: [],
        metrics: { reviewCount: 0, needsReviewCount: 0, improvedCount: 0, activeDays: 0 },
        generatedAt: new Date().toISOString(),
      },
    }),
  );

  await page.goto('/login?next=//example.com');
  await page.getByPlaceholder('访问口令').fill(PASSCODE);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('http://127.0.0.1:3100/graph');
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:3100');
});

test('登录后可加载 mock 知识图谱', async ({ page }) => {
  await page.route('**/api/graph', (route) =>
    route.fulfill({
      json: {
        nodes: [
          {
            id: 'node-a',
            title: '遗忘曲线',
            memory: 0.72,
            viewCount: 3,
            readingMs: 60_000,
            documentTitle: '学习科学',
          },
          {
            id: 'node-b',
            title: '间隔复习',
            memory: 0.45,
            viewCount: 2,
            readingMs: 42_000,
            documentTitle: '学习科学',
          },
        ],
        edges: [{ source: 'node-a', target: 'node-b', kind: 'doc', weight: 0.3 }],
      },
    }),
  );

  await page.goto('/login?next=/graph');
  await page.getByPlaceholder('访问口令').fill(PASSCODE);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('**/graph');
  await expect(page.getByRole('heading', { name: '关系图谱' })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
});

test('主动回忆先作答，再揭晓答案并记录结果', async ({ page }) => {
  const version = 'a'.repeat(64);
  await page.route('**/api/learning/question', (route) =>
    route.fulfill({
      json: {
        segment: {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'HashMap 冲突处理',
          documentId: '44444444-4444-4444-8444-444444444444',
          documentTitle: 'Java',
        },
        question: 'HashMap 如何处理哈希冲突？',
        referenceAnswer: '主要使用链地址法，并在链表较长时转为红黑树。',
        sourceVersion: version,
        generatedBy: 'ai',
      },
    }),
  );
  await page.route('**/api/learning/reviews', (route) =>
    route.fulfill({
      json: {
        duplicate: false,
        review: {
          id: 'review-1',
          reviewedAt: '2026-10-29T00:00:00.000Z',
          nextReviewAt: '2026-11-05T00:00:00.000Z',
        },
      },
    }),
  );

  await page.goto('/login?next=/study/33333333-3333-4333-8333-333333333333');
  await page.getByPlaceholder('访问口令').fill(PASSCODE);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('**/study/**');

  await expect(page.getByText('HashMap 如何处理哈希冲突？')).toBeVisible();
  await expect(page.getByText('主要使用链地址法')).toHaveCount(0);
  await page.getByLabel('你的回答').fill('链地址法，长链表会树化');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await expect(page.getByText('主要使用链地址法')).toBeVisible();
  await page.getByRole('button', { name: /答对了/ }).click();
  await expect(page.getByText('复习已记录')).toBeVisible();
});

test('选中正文后可请求 AI 解释且不跳转', async ({ page }) => {
  await page.route('**/api/notes/test-note-id/annotations', (route) => route.fulfill({ json: { annotations: [] } }));
  await page.route('**/api/notes/test-note-id', (route) =>
    route.fulfill({
      json: {
        document: {
          id: 'test-note-id',
          title: '测试文档',
          tags: [],
          segmentCount: 1,
          createdAt: '2026-10-29T00:00:00.000Z',
          storageKey: null,
        },
        segments: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            title: '索引',
            headingPath: '',
            tags: [],
            viewCount: 1,
            content: '数据库索引能减少扫描范围并加快查询。',
            memory: 0.5,
          },
        ],
      },
    }),
  );
  await page.route('**/api/ai/explain', (route) =>
    route.fulfill({
      json: {
        explanation: '索引像一本书的目录，先定位范围，再读取具体内容。',
        segment: { id: '55555555-5555-4555-8555-555555555555', title: '索引', documentTitle: '测试文档' },
        contextUsed: [],
      },
    }),
  );

  await page.goto('/login?next=/notes/test-note-id');
  await page.getByPlaceholder('访问口令').fill(PASSCODE);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('**/notes/test-note-id');
  await expect(page.getByRole('heading', { name: '索引' })).toBeVisible();

  await page.evaluate(() => {
    const paragraph = document.querySelector('.md-body p');
    const text = paragraph?.firstChild;
    if (!paragraph || !text) throw new Error('正文未渲染');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(5, text.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: /解释/ }).click();
  await expect(page.getByText('AI 解释这段', { exact: true })).toBeVisible();
  await expect(page.getByText('索引像一本书的目录')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/notes/test-note-id');
});

test('学习复盘展示周期对比和 14 天热力', async ({ page }) => {
  await page.route('**/api/learning/weekly', (route) =>
    route.fulfill({
      json: {
        summary: '近 7 天完成 6 次主动回忆，其中 2 次需要继续巩固。',
        current: { reviewCount: 6, needsReviewCount: 2, improvedCount: 1, activeDays: 3 },
        previous: { reviewCount: 4, needsReviewCount: 3, improvedCount: 0, activeDays: 2 },
        days: Array.from({ length: 14 }, (_, index) => ({
          day: `2026-10-${String(16 + index).padStart(2, '0')}`,
          reviews: index % 3,
          readingSessions: index % 2,
          readingMs: index * 10_000,
          needsReview: index % 3,
        })),
        priorityItems: [],
      },
    }),
  );

  await page.goto('/login?next=/progress');
  await page.getByPlaceholder('访问口令').fill(PASSCODE);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('**/progress');
  await expect(page.getByRole('heading', { name: '学习复盘' })).toBeVisible();
  await expect(page.getByText('近 7 天完成 6 次主动回忆')).toBeVisible();
  await expect(page.getByText('14 天学习热力')).toBeVisible();
});
