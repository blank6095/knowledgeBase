/** 收尾截图与补充校验：桌面详情面板截图、U1-1 未实施确认（/ 仍为默认页）、h1 存在性。 */
import { chromium } from 'playwright';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3103';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const out = {};
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`);
  out.afterLoginPath = new URL(page.url()).pathname;
  out.isDefaultPage = new URL(page.url()).pathname === '/';

  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  out.h1 = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return h1 ? { text: h1.textContent, className: h1.className } : null;
  });
  const pos = await page.evaluate(() => window.__kbGraphNodePositions[0]);
  const pt = await page.evaluate(({ x, y }) => {
    const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, pos);
  await page.mouse.click(pt.x, pt.y);
  await page.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('aside[aria-label="知识点详情"] h2').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/phase1-qa-desktop-detail.png' });
  out.panelVisible = true;
  out.pageErrors = errors;
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close().catch(() => {});
}
