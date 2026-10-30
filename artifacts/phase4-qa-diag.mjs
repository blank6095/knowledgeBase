/** 诊断：U4-1 focus 视觉调光 + 8k 右键菜单是否触发。 */
import { chromium, request } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror ' + String(e)));
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60000 });
  await page.waitForTimeout(500);
  const api = await request.newContext({ baseURL });
  await api.post('/api/auth/login', { data: { passcode } });
  const payload = await (await api.get('/api/graph')).json();
  const ends = (l) => [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target];
  const adj = new Map();
  for (const l of payload.edges) {
    const [s, t] = ends(l);
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  }
  const deg = (id) => (adj.get(id) ?? new Set()).size;
  const seed = [...payload.nodes].sort((a, b) => deg(b.id) - deg(a.id))[0];
  console.log('seed', seed.title, 'degree', deg(seed.id), 'neighbors', [...(adj.get(seed.id) ?? [])].length);
  const positions = await page.evaluate(() => window.__kbGraphNodePositions);
  const pos = positions.find((p) => p.id === seed.id);
  const pt = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
    return { x: r.left + p.x, y: r.top + p.y, tag: document.elementFromPoint(r.left + p.x, r.top + p.y)?.tagName };
  }, pos);
  console.log('click pt', pt);
  await page.mouse.click(pt.x, pt.y);
  await page.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('aside[aria-label="知识点详情"] h2').first().waitFor({ state: 'visible' });
  const btn = page.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
  console.log('button before', (await btn.innerText()).trim());
  await btn.click();
  await page.waitForTimeout(500);
  console.log('button after', (await btn.innerText()).trim(), 'pressed', await btn.getAttribute('aria-pressed'));
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx2 = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    return (window.__kbGraphNodePositions ?? []).map((p) => {
      const s = window.__kbGraphInstance.graph2ScreenCoords(p.x, p.y);
      const sx = (s.x / r.width) * canvas.width;
      const sy = (s.y / r.height) * canvas.height;
      if (s.x < 4 || s.y < 4 || s.x > r.width - 4 || s.y > r.height - 4) return { id: p.id, alpha: null };
      const d = ctx2.getImageData(Math.round(sx) - 2, Math.round(sy) - 2, 5, 5).data;
      let max = 0;
      for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i]);
      return { id: p.id, alpha: +(max / 255).toFixed(2) };
    });
  });
  console.log('alphas', JSON.stringify(sample));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  const sample2 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx2 = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    return (window.__kbGraphNodePositions ?? []).map((p) => {
      const s = window.__kbGraphInstance.graph2ScreenCoords(p.x, p.y);
      const sx = (s.x / r.width) * canvas.width;
      const sy = (s.y / r.height) * canvas.height;
      if (s.x < 4 || s.y < 4 || s.x > r.width - 4 || s.y > r.height - 4) return { id: p.id, alpha: null };
      const d = ctx2.getImageData(Math.round(sx) - 2, Math.round(sy) - 2, 5, 5).data;
      let max = 0;
      for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i]);
      return { id: p.id, alpha: +(max / 255).toFixed(2) };
    });
  });
  console.log('alphas after blur', JSON.stringify(sample2));
  console.log('button now', (await btn.innerText()).trim(), 'panel', await page.locator('aside[aria-label="知识点详情"]').count());
  // 8k right-click 诊断
  await page.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length === 8000, undefined, { timeout: 180000 });
  await page.waitForTimeout(600);
  const big = await page.evaluate(() => window.__kbGraphNodePositions.slice(0, 5));
  for (const p of big) {
    const info = await page.evaluate(({ x, y }) => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      const s = window.__kbGraphInstance.graph2ScreenCoords(x, y);
      const el = document.elementFromPoint(r.left + s.x, r.top + s.y);
      return { x: r.left + s.x, y: r.top + s.y, tag: el?.tagName, inCanvas: s.x > 5 && s.y > 5 && s.x < r.width - 5 && s.y < r.height - 5 };
    }, p);
    if (!info.inCanvas) {
      console.log('skip offscreen', info);
      continue;
    }
    await page.mouse.click(info.x, info.y, { button: 'right' });
    await page.waitForTimeout(400);
    const menuCount = await page.locator('[role="menu"]').count();
    console.log('rightclick', JSON.stringify(info), 'menu', menuCount);
    if (menuCount) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      break;
    }
  }
  console.log('logs', logs);
} finally {
  await browser.close().catch(() => {});
}
