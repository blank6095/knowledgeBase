/**
 * U4-6 小地图实现侧验收（Lead）。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')));
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const OUT = join(process.cwd(), 'artifacts');
await mkdir(OUT, { recursive: true });
const envText = await readFile(join(process.cwd(), '.env.local'), 'utf8');
const passcode = envText.match(/^AUTH_PASSCODE\s*=\s*(.*)$/m)[1].trim();

const result = { checks: {}, consoleErrors: [], pageErrors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
let requestLog = [];
page.on('request', (req) => requestLog.push(req.url()));
page.on('pageerror', (e) => result.pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(`${page.url()} :: ${m.text()}`.slice(0, 800));
});

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('访问口令');
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const submit = page.getByRole('button', { name: '进入' });
  for (let i = 0; i < 20; i += 1) {
    await input.fill(passcode);
    await page.waitForTimeout(300);
    if (await submit.isEnabled().catch(() => false)) break;
  }
  await submit.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function waitGraph() {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await page.evaluate(() => window.__kbGraphEngineStop !== undefined).catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
}

const camera = () =>
  page.evaluate(() => {
    const fg = window.__kbGraphInstance;
    const c = fg.centerAt();
    return { x: c?.x ?? null, y: c?.y ?? null, zoom: fg.zoom() };
  });

await login();
await waitGraph();
await page.screenshot({ path: join(OUT, 'phase7-minimap-off.png') });

// 打开显示 tab，勾选小地图
await page.getByRole('button', { name: '关系图谱设置' }).click();
await page.getByRole('button', { name: '显示', exact: true }).click();
await page.getByText('小地图（全景导航）').click();
await page.locator('canvas[aria-label^="图谱小地图"]').waitFor({ state: 'visible', timeout: 10_000 });
await page.waitForTimeout(800);
result.checks.shown = {
  minimap: await page.locator('canvas[aria-label^="图谱小地图"]').count(),
  engineStop: await page.evaluate(() => window.__kbGraphEngineStop ?? null),
};
await page.screenshot({ path: join(OUT, 'phase7-minimap-on.png') });

// 点击小地图左下角 → 相机中心应变化，且不请求接口、engineStop 不变
const before = await camera();
const engineBefore = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
requestLog = [];
await page.locator('canvas[aria-label^="图谱小地图"]').click({ position: { x: 12, y: 90 } });
await page.waitForTimeout(800);
const after = await camera();
result.checks.clickJump = {
  before,
  after,
  moved: Math.abs((after.x ?? 0) - (before.x ?? 0)) > 1 || Math.abs((after.y ?? 0) - (before.y ?? 0)) > 1,
  engineStopUnchanged: engineBefore === (await page.evaluate(() => window.__kbGraphEngineStop ?? null)),
  apiRequests: requestLog.filter((url) => url.includes('/api/graph') || url.includes('/fixtures/')).length,
};
await page.screenshot({ path: join(OUT, 'phase7-minimap-jump.png') });

// 移动端
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(800);
const mobile = await page.evaluate(() => {
  const mm = document.querySelector('canvas[aria-label^="图谱小地图"]');
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  const r = mm?.getBoundingClientRect();
  const n = nav?.getBoundingClientRect();
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    minimap: r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
    navTop: n?.top ?? null,
    overlapNav: Boolean(r && n && r.bottom > n.top),
  };
});
result.checks.mobile = { ...mobile, noHorizontalOverflow: mobile.scrollWidth <= mobile.innerWidth };
await page.screenshot({ path: join(OUT, 'phase7-minimap-mobile.png') });

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase7-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
