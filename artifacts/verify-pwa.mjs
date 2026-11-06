/**
 * 手机端 PWA 修复验收：刘海安全区、导航一致、学习地图可关闭、manifest/status bar。
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
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

// 模拟刘海/Home Indicator（Chrome CDP；不支持则记录 skipped）
async function setSafeArea() {
  try {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setSafeAreaInsets', {
      insets: { top: 47, bottom: 34, left: 0, right: 0 },
    });
    return true;
  } catch {
    return false;
  }
}

const navLabels = () =>
  page.$$eval('nav[aria-label="知识宇宙导航"] a, nav[aria-label="知识宇宙导航"] button', (els) =>
    els.map((el) => el.getAttribute('aria-label')).filter(Boolean),
  );

await login();
await waitGraph();
result.checks.manifest = await page.evaluate(async () => {
  const res = await fetch('/manifest.webmanifest');
  const json = await res.json().catch(() => null);
  return { status: res.status, name: json?.name, start_url: json?.start_url, display: json?.display, icons: json?.icons?.length };
});
result.checks.meta = await page.evaluate(() => ({
  viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content'),
  themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'),
  appleStatus: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'),
  manifestLink: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
}));
result.checks.safeAreaSupported = await setSafeArea();
await page.waitForTimeout(500);

// 安全区：顶栏在刘海下方，底部导航在 Home Indicator 上方
result.checks.safeMetrics = await page.evaluate(() => {
  const topbar = document.querySelector('header');
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  return {
    viewportH: window.innerHeight,
    topbarTop: topbar?.getBoundingClientRect().top ?? null,
    navBottom: nav?.getBoundingClientRect().bottom ?? null,
  };
});
await page.screenshot({ path: join(OUT, 'pwa-fix-graph-safe.png') });
result.checks.graphNav = await navLabels();

// 导航一致性：/notes 与 /graph 项数/标签一致
await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
result.checks.notesNav = await navLabels();
result.checks.navConsistent =
  JSON.stringify(result.checks.graphNav) === JSON.stringify(result.checks.notesNav);
await page.screenshot({ path: join(OUT, 'pwa-fix-notes-safe.png') });

// 学习地图关闭：桌面/移动均通过更多操作 → 学习地图 → 全部显示 → 关闭学习地图
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await waitGraph();
await page.getByRole('button', { name: '更多操作' }).click();
await page.getByRole('menuitem', { name: /学习地图/ }).click();
await page.getByRole('button', { name: '关闭设置面板' }).waitFor({ state: 'visible', timeout: 8_000 });
await page.getByRole('button', { name: '全部显示' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'pwa-fix-map-open.png') });
await page.getByRole('button', { name: '关闭学习地图' }).click();
await page.waitForTimeout(500);
result.checks.mapClosed = {
  panel: await page.getByRole('button', { name: '关闭设置面板' }).count(),
  legend: await page.locator('div.absolute.bottom-8.left-3').count(),
  button: await page.getByRole('button', { name: /学习地图/ }).innerText().catch(() => null),
};
await page.screenshot({ path: join(OUT, 'pwa-fix-map-closed.png') });

// 关闭按钮也能关面板
await page.getByRole('button', { name: '更多操作' }).click();
await page.getByRole('menuitem', { name: /学习地图/ }).click();
await page.getByRole('button', { name: '关闭设置面板' }).click();
await page.waitForTimeout(300);
result.checks.panelCloseButton = (await page.getByRole('button', { name: '关闭设置面板' }).count()) === 0;

// 桌面视图导航一致性
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
result.checks.notesNavDesktop = await navLabels();

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'pwa-fix-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
