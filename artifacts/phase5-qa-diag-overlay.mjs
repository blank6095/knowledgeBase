/** 诊断：Next dev overlay 是否出现、覆盖范围与来源。 */
import { chromium } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('console ' + m.text().slice(0, 200));
});
page.on('pageerror', (e) => logs.push('pageerror ' + String(e)));
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/graph`);
  await page.waitForTimeout(1200);
  const probe = async (label) => {
    const info = await page.evaluate(() => {
      const portals = [...document.querySelectorAll('nextjs-portal')];
      return portals.map((p) => {
        const r = p.getBoundingClientRect();
        const style = getComputedStyle(p);
        return {
          rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          pointerEvents: style.pointerEvents,
          html: p.shadowRoot ? p.shadowRoot.innerHTML.slice(0, 300) : p.innerHTML.slice(0, 300),
        };
      });
    });
    console.log(label, JSON.stringify(info));
  };
  await probe('after graph');
  // 点击一个节点打开详情
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60000 });
  const pos = await page.evaluate(() => window.__kbGraphNodePositions[0]);
  const pt = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
    return { x: r.left + p.x, y: r.top + p.y };
  }, pos);
  await page.mouse.click(pt.x, pt.y);
  await page.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  await probe('after detail');
  const closeVisible = await page.locator('button[aria-label="关闭详情"]').isVisible();
  console.log('close visible', closeVisible);
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="关闭详情"]');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tag: el?.tagName, portal: Boolean(el?.closest('nextjs-portal')) };
  });
  console.log('hit at close', JSON.stringify(hit));
  console.log('logs', logs);
  await page.screenshot({ path: 'artifacts/phase5-qa-diag-overlay.png' });
} finally {
  await browser.close().catch(() => {});
}
