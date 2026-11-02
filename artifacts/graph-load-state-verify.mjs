/**
 * 图谱加载态验收（对应移动端「一直停在骨架屏」）。
 *
 * 复用已在运行的 dev/start 服务（默认 3100），在手机视口下验证三条路径：
 * 1. 接口失败 → 出现「图谱没能加载」卡片 + 重新加载 / 返回知识库两个出口；
 * 2. 接口慢（>10s）→ 骨架屏下方出现慢网提示与「重新加载」；
 * 3. 点「重新加载」→ 重新发起请求并正常渲染画布。
 *
 * 用法：AUTH_PASSCODE=xxx node artifacts/graph-load-state-verify.mjs [--port 3100]
 */
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { port: { type: 'string', default: '3100' } } });
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = process.env.AUTH_PASSCODE || '';
if (!passcode) throw new Error('缺少 AUTH_PASSCODE');

const PAYLOAD = {
  nodes: [
    { id: 'a', title: '遗忘曲线', memory: 0.7, viewCount: 3, readingMs: 60000, documentTitle: '学习科学' },
    { id: 'b', title: '间隔复习', memory: 0.4, viewCount: 2, readingMs: 42000, documentTitle: '学习科学' },
  ],
  edges: [{ source: 'a', target: 'b', kind: 'doc', weight: 0.3 }],
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const rows = {};

try {
  await page.goto(`${baseURL}/login?next=/graph`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL((url) => new URL(url).pathname === '/graph', { timeout: 30_000 });

  // 1) 失败态
  await page.route('**/api/graph', (route) => route.abort('failed'));
  await page.reload();
  await page.getByText('图谱没能加载').waitFor({ timeout: 15_000 });
  rows.error = {
    title: await page.getByText('图谱没能加载').isVisible(),
    hasRetry: await page.getByRole('button', { name: '重新加载' }).isVisible(),
    hasExit: await page.getByRole('link', { name: '返回知识库' }).isVisible(),
    detail: (await page.locator('[role="alert"] p').nth(1).textContent())?.slice(0, 60),
  };
  await page.screenshot({ path: 'artifacts/mobile-final/load-error.png' });
  await page.unroute('**/api/graph');

  // 2) 点「重新加载」→ 重新请求并出图
  await page.route('**/api/graph', (route) => route.fulfill({ json: PAYLOAD }));
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  rows.retry = { canvasVisible: true };
  await page.unroute('**/api/graph');

  // 3) 慢网态（11s 后返回），确认 10s 时出现提示
  await page.route('**/api/graph', async (route) => {
    await new Promise((r) => setTimeout(r, 11_000));
    await route.fulfill({ json: PAYLOAD });
  });
  await page.reload();
  await page.getByText('网络较慢，图谱仍在加载…').waitFor({ timeout: 14_000 });
  rows.slow = { hintVisible: true };
  await page.screenshot({ path: 'artifacts/mobile-final/load-slow.png' });

  // 慢网最终完成后正常出图
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  rows.slow.canvasAfterSlowLoad = true;
  await page.unroute('**/api/graph');
} finally {
  await browser.close();
}

console.log(JSON.stringify(rows, null, 2));
