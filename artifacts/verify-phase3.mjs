/**
 * 阶段 3 + U1-1/UQ2 实现侧验收（Lead）：冷色主题、4 环境、4 节点风格、持久化、全站窄导航。
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
page.on('pageerror', (e) => result.pageErrors.push(e.message));
page.on('console', async (m) => {
  if (m.type() === 'error' && m.text().includes('hydrated')) {
    const args = [];
    for (const arg of m.args()) {
      try { args.push(await arg.jsonValue()); } catch { args.push(String(arg)); }
    }
    console.log('HYDRATION_ARGS', JSON.stringify(args));
  }
});
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(`${stage} :: ${page.url()} :: ${m.text()}`.slice(0, 1600));
});
let requestLog = [];
let stage = 'boot';
page.on('request', (req) => requestLog.push(req.url()));

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

const themeInfo = () =>
  page.evaluate(() => ({
    htmlEnv: document.documentElement.dataset.graphEnv,
    bgEnv: document.querySelector('.graph-background')?.getAttribute('data-graph-env') ?? null,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
    app: getComputedStyle(document.documentElement).getPropertyValue('--color-app').trim(),
    engineStop: window.__kbGraphEngineStop ?? null,
  }));

stage = '1-login';
// ---------- 1) U1-1 登录直达图谱 ----------
await login();
result.checks.landing = {
  pathname: new URL(page.url()).pathname,
  url: page.url(),
};
stage = '1-wait-graph';
await waitGraph();
await page.screenshot({ path: join(OUT, 'phase3-default-cold.png') });
result.checks.defaultTheme = await themeInfo();

stage = '2-panel';
// ---------- 2) 主题面板 ----------
await page.locator('nav[aria-label="知识宇宙导航"] button[aria-label="外观主题"]').click();
await page.getByRole('button', { name: '主题', exact: true }).click();
await page.getByRole('region', { name: '图谱外观主题' }).waitFor({ state: 'visible', timeout: 5_000 });
await page.screenshot({ path: join(OUT, 'phase3-theme-panel.png') });
result.checks.panel = { visible: true };

stage = '3-env';
// ---------- 3) 4 套环境切换 ----------
const envResults = [];
for (const [button, id, shot] of [
  ['数字空间', 'digital', 'phase3-env-digital.png'],
  ['极光', 'aurora', 'phase3-env-aurora.png'],
  ['极简', 'minimal', 'phase3-env-minimal.png'],
]) {
  const before = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
  requestLog = [];
  await page.getByRole('button', { name: button }).click();
  await page.waitForTimeout(500);
  const info = await themeInfo();
  const requests = requestLog.filter((url) => url.includes('/api/graph') || url.includes('/fixtures/'));
  envResults.push({ id, ...info, engineStopUnchanged: before === info.engineStop, apiRequests: requests.length });
  await page.screenshot({ path: join(OUT, shot) });
}
result.checks.environments = envResults;

stage = '4-styles';
// ---------- 4) 4 种节点风格 ----------
const styleResults = [];
for (const [button, shot] of [
  ['晶体', 'phase3-style-crystal.png'],
  ['线框', 'phase3-style-wire.png'],
  ['能量球', 'phase3-style-energy.png'],
  ['光点', 'phase3-style-orb.png'],
]) {
  await page.getByRole('button', { name: button }).click();
  await page.waitForTimeout(400);
  styleResults.push({ style: button, htmlEnv: (await themeInfo()).htmlEnv });
  await page.screenshot({ path: join(OUT, shot) });
}
result.checks.styles = styleResults;

stage = '4b-slider';
const ranges = page.locator('input[type="range"]');
if ((await ranges.count()) >= 2) {
  await ranges.first().fill('1.4');
  await page.waitForTimeout(300);
}
result.checks.persistBeforeReload = await page.evaluate(() => ({
  stored: localStorage.getItem('kb.graph.preferences.v1'),
  htmlEnv: document.documentElement.dataset.graphEnv,
}));

stage = '5-reload';
// ---------- 5) 刷新恢复 ----------
await page.reload({ waitUntil: 'domcontentloaded' });
await waitGraph();
result.checks.afterReload = {
  ...(await themeInfo()),
  stored: await page.evaluate(() => localStorage.getItem('kb.graph.preferences.v1')),
};

stage = '6-notes';
// ---------- 6) 全站窄导航 ----------
stage = '6-notes-load';
await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
await page.locator('nav[aria-label="知识宇宙导航"]').waitFor({ state: 'visible', timeout: 15_000 });
const notes = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  const main = document.querySelector('main');
  return {
    navCount: document.querySelectorAll('nav[aria-label="知识宇宙导航"]').length,
    sidebarAside: document.querySelectorAll('aside').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    mainRect: main?.getBoundingClientRect().toJSON() ?? null,
    navRect: nav?.getBoundingClientRect().toJSON() ?? null,
  };
});
result.checks.notes = { ...notes, noHorizontalOverflow: notes.scrollWidth <= notes.innerWidth };
await page.screenshot({ path: join(OUT, 'phase3-notes-rail.png') });

stage = '6b-mobile';
// 移动端
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const mobileNotes = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    navRect: nav?.getBoundingClientRect().toJSON() ?? null,
  };
});
result.checks.mobileNotes = { ...mobileNotes, noHorizontalOverflow: mobileNotes.scrollWidth <= mobileNotes.innerWidth };
await page.screenshot({ path: join(OUT, 'phase3-mobile-notes.png') });

stage = '6c-graph';
// /graph 仍只有一个 nav + 7 项
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await waitGraph();
result.checks.graphNav = await page.evaluate(() => ({
  navCount: document.querySelectorAll('nav[aria-label="知识宇宙导航"]').length,
  items: document.querySelectorAll('nav[aria-label="知识宇宙导航"] li').length,
}));
await page.screenshot({ path: join(OUT, 'phase3-graph-cold.png') });

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase3-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
