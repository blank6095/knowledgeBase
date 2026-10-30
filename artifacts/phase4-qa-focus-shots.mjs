/** 补拍阶段 4 QA 截图：一阶/二阶 focus 高亮（生产构建 3103）。 */
import { chromium } from 'playwright';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3103';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
  const pos = await page.evaluate(() => window.__kbGraphNodePositions[0]);
  const pt = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
    return { x: r.left + p.x, y: r.top + p.y };
  }, pos);
  await page.mouse.click(pt.x, pt.y);
  await page.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 10000 });
  const btn = page.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
  await btn.click();
  await page.waitForTimeout(500);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/phase4-qa-focus-1hop.png' });
  await btn.click();
  await page.waitForTimeout(500);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/phase4-qa-focus-2hop.png' });
  console.log('captured focus-1hop / focus-2hop');
} finally {
  await browser.close().catch(() => {});
}
