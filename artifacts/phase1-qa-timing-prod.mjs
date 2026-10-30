/** 生产构建下的单击→详情面板延迟复测（只读源码，只写 artifacts/）。用法：KB_PASSCODE=... node artifacts/phase1-qa-timing-prod.mjs */
import { chromium } from 'playwright';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3103';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
const page = await ctx.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 200));
});
const panel = () => page.locator('aside[aria-label="知识点详情"]');
const blank = () =>
  page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const pts = (window.__kbGraphNodePositions ?? []).map((n) => {
      const p = window.__kbGraphInstance.graph2ScreenCoords(n.x, n.y);
      return { x: p.x + r.left, y: p.y + r.top };
    });
    const cands = [
      { x: r.left + 40, y: r.top + 120 },
      { x: r.left + r.width / 2, y: r.top + r.height - 150 },
      { x: r.left + r.width - 60, y: r.top + r.height - 100 },
    ];
    return cands.find((c) => pts.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 80)) ?? cands[0];
  });
const screen = (pos) =>
  page.evaluate(({ x, y }) => {
    const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, pos);

const out = { baseURL, samples: [], layout: null, h1: null };
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60_000 });
  await page.waitForTimeout(600);
  out.h1 = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return h1 ? { text: h1.textContent, className: h1.className, rect: h1.getBoundingClientRect().width } : null;
  });
  out.layout = await page.evaluate(() => {
    const c = document.querySelector('canvas').getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
    const navRect = nav?.getBoundingClientRect();
    return {
      canvas: { top: c.top, height: c.height },
      innerHeight: window.innerHeight,
      navItems: nav ? nav.querySelectorAll('[aria-label]').length : 0,
      navRect: navRect ? { top: navRect.top, bottom: navRect.bottom } : null,
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
    };
  });

  const positions = await page.evaluate(() => window.__kbGraphNodePositions ?? []);
  for (let i = 0; i < 5; i += 1) {
    if (await panel().isVisible().catch(() => false)) {
      const b = await blank();
      await page.mouse.click(b.x, b.y);
      await panel().waitFor({ state: 'detached', timeout: 5_000 });
    }
    const pos = positions[i % positions.length];
    await page.evaluate(() => {
      window.__qaDetailAt = null;
      window.__qaObserver?.disconnect?.();
      window.__qaObserver = new MutationObserver(() => {
        if (window.__qaDetailAt === null && document.querySelector('aside[aria-label="知识点详情"]')) {
          window.__qaDetailAt = performance.now();
        }
      });
      window.__qaObserver.observe(document.body, { childList: true, subtree: true });
      window.__qaClickAt = performance.now();
    });
    const pt = await screen(pos);
    await page.mouse.click(pt.x, pt.y);
    const deadline = Date.now() + 5_000;
    let at = null;
    while (Date.now() < deadline && at === null) {
      at = await page.evaluate(() => window.__qaDetailAt);
      if (at === null) await page.waitForTimeout(20);
    }
    await page.evaluate(() => window.__qaObserver?.disconnect?.());
    const delta = at === null ? null : await page.evaluate((d) => d - window.__qaClickAt, at);
    out.samples.push(delta);
    await panel().waitFor({ state: 'visible', timeout: 5_000 });
  }
  out.pageErrors = pageErrors;
  out.consoleErrors = consoleErrors;
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close().catch(() => {});
}
