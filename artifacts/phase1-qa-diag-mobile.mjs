/** 诊断脚本：移动端 375×812 下详情 Drawer 与底部导航的层级/命中关系（只写 artifacts/）。 */
import { chromium } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 90_000 });
  await page.waitForTimeout(500);
  const posList = await page.evaluate(() => window.__kbGraphNodePositions ?? []);
  console.log('positions', posList.length, 'viewport', await page.evaluate(() => [innerWidth, innerHeight]));
  let clicked = null;
  for (const pos of posList.slice(0, 8)) {
    const pt = await page.evaluate(({ x, y }) => {
      const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
      const r = document.querySelector('canvas').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + p.x, r.top + p.y);
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y), tag: el?.tagName ?? null, cls: String(el?.className ?? '').slice(0, 60), canvasRect: [r.top, r.height] };
    }, pos);
    console.log('candidate', JSON.stringify(pt));
    if (pt.tag !== 'CANVAS') continue;
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({
      panel: document.querySelectorAll('aside[aria-label="知识点详情"]').length,
      url: location.pathname,
      bodyHas: document.body.innerText.includes('知识点'),
    }));
    console.log('after click', JSON.stringify(info));
    if (info.panel > 0) {
      clicked = { pos, pt };
      break;
    }
  }
  if (!clicked) throw new Error('无法在移动端命中节点打开详情面板');
  const diag = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) };
    };
    const panel = document.querySelector('aside[aria-label="知识点详情"]');
    const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
    const legend = document.querySelector('section[aria-label="记忆度图例"]') ?? document.querySelector('button[aria-label="展开记忆度图例"]');
    const navRect = nav.getBoundingClientRect();
    const cx = navRect.left + navRect.width / 2;
    const cy = navRect.top + navRect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${String(el.className).slice(0, 60)}`);
    const z = (el) => (el ? `${getComputedStyle(el).zIndex}/${getComputedStyle(el).position}` : 'null');
    // 面板各关键子元素
    const btns = [...panel.querySelectorAll('button')].map((b) => ({ text: b.innerText.trim().slice(0, 12), r: rect(b), z: z(b) }));
    return {
      innerHeight: window.innerHeight,
      panel: rect(panel),
      panelZ: z(panel),
      nav: rect(nav),
      navZ: z(nav),
      legend: legend ? rect(legend) : null,
      hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 50)}` : null,
      hitInNav: Boolean(hit?.closest?.('nav')),
      stack,
      buttons: btns.slice(0, 4),
      overflowPanel: getComputedStyle(panel).overflowY,
    };
  });
  console.log(JSON.stringify(diag, null, 2));
  console.log('pageErrors', errors);
} finally {
  await browser.close().catch(() => {});
}
