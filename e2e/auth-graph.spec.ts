import { expect, test } from '@playwright/test';

const PASSCODE = 'e2e-passcode';

test('未登录访问页面会进入登录页', async ({ page }) => {
  await page.goto('/notes');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByPlaceholder('访问口令')).toBeVisible();
});

test('登录 next 参数不允许跳出当前站点', async ({ page }) => {
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
  await page.waitForURL('http://127.0.0.1:3100/');
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
