/**
 * 阶段 2 实现侧验收（Lead）：搜索浮层 / 四态视觉 / 空态 / 视口聚焦 / 回归。
 * 截图与结果写入 artifacts/。
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
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(m.text().slice(0, 300));
});
let requestLog = [];
page.on('request', (req) => requestLog.push(req.url()));

async function loginIfNeeded() {
  if (!page.url().includes('/login')) return;
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

async function openGraph(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await loginIfNeeded();
  if (!page.url().includes('/graph')) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    if (await page.evaluate(() => window.__kbGraphEngineStop !== undefined).catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(600);
}

const searchInput = () => page.getByRole('combobox', { name: '搜索知识' });
const nodePositions = () => page.evaluate(() => window.__kbGraphNodePositions ?? []);
const nodeScreen = (id) =>
  page.evaluate((targetId) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    const pos = (window.__kbGraphNodePositions ?? []).find((item) => item.id === targetId);
    if (!fg || !canvas || !pos) return null;
    const pt = fg.graph2ScreenCoords(pos.x, pos.y);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + pt.x, y: rect.top + pt.y, cx: rect.width / 2, cy: rect.height / 2 };
  }, id);

await openGraph(`${BASE}/graph`);
await page.screenshot({ path: join(OUT, 'phase2-desktop-default.png') });

// ---------- 1) Ctrl+K 打开 / 键盘 / 输入不请求 ----------
await page.keyboard.press('Control+k');
await searchInput().waitFor({ state: 'visible', timeout: 5_000 });
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
result.checks.openShortcut = { visible: true, focused };
requestLog = [];
await searchInput().fill('网络');
await page.getByRole('listbox', { name: '搜索结果' }).waitFor({ state: 'visible', timeout: 5_000 });
await page.waitForTimeout(500);
const requestsWhileTyping = requestLog.filter((url) => url.includes('/api/graph') || url.includes('/fixtures/'));
const hits = await page.getByRole('option').allInnerTexts();
result.checks.search = {
  resultCount: hits.length,
  firstResults: hits.slice(0, 3),
  apiRequests: requestsWhileTyping,
  engineStop: await page.evaluate(() => window.__kbGraphEngineStop ?? null),
};
await page.screenshot({ path: join(OUT, 'phase2-desktop-hit.png') });

// ---------- 2) 空结果态 ----------
await searchInput().fill('绝无此关键词xyzzy');
await page.getByText('没有找到匹配知识').waitFor({ state: 'visible', timeout: 5_000 });
result.checks.empty = { visible: true, canvasStillVisible: await page.locator('canvas').first().isVisible() };
await page.screenshot({ path: join(OUT, 'phase2-desktop-empty.png') });

// ---------- 3) Esc 清除并恢复全图 ----------
await searchInput().fill('网络');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
result.checks.escape = {
  panelVisible: await page.getByRole('combobox', { name: '搜索知识' }).count(),
  url: page.url(),
};

// ---------- 4) Enter 聚焦：目标节点应移动到画布中心 ----------
await page.keyboard.press('Control+k');
await searchInput().fill('TCP');
await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 5_000 });
const firstOption = page.getByRole('option').first();
const firstTitle = (await firstOption.innerText()).split('\n')[0];
// 通过 API 拿节点标题 → id 的映射，找到目标 id（避免依赖内部 state）
const idByTitle = await page.evaluate(async () => {
  const res = await fetch('/api/graph');
  const json = await res.json();
  const map = {};
  for (const node of json.nodes ?? []) map[node.title] = node.id;
  return map;
});
const targetId = idByTitle[firstTitle];
const before = await nodeScreen(targetId);
const engineBefore = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
requestLog = [];
await searchInput().press('Enter');
await page.waitForTimeout(700);
const after = await nodeScreen(targetId);
const requestsDuringFocus = requestLog.filter((url) => url.includes('/api/graph') || url.includes('/fixtures/'));
result.checks.focus = {
  targetId,
  firstTitle,
  before,
  after,
  dx: before && after ? Math.round(after.x - after.cx) : null,
  dy: before && after ? Math.round(after.y - after.cy) : null,
  centered: Boolean(before && after && Math.abs(after.x - after.cx) < 40 && Math.abs(after.y - after.cy) < 40),
  apiRequests: requestsDuringFocus,
  engineStopUnchanged: engineBefore === (await page.evaluate(() => window.__kbGraphEngineStop ?? null)),
  moved: Boolean(before && after && (Math.abs(after.x - before.x) > 2 || Math.abs(after.y - before.y) > 2)),
};
await page.screenshot({ path: join(OUT, 'phase2-desktop-focus.png') });

// ---------- 5) 搜索退出后回归（单击详情 / 双选入口仍在） ----------
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const pos = await nodePositions();
const clickTarget = await page.evaluate(() => {
  const fg = window.__kbGraphInstance;
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  for (const item of window.__kbGraphNodePositions ?? []) {
    const pt = fg.graph2ScreenCoords(item.x, item.y);
    const x = rect.left + pt.x;
    const y = rect.top + pt.y;
    if (x < rect.left + 24 || x > rect.right - 24 || y < rect.top + 24 || y > rect.bottom - 24) continue;
    if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y };
  }
  return null;
});
if (clickTarget) {
  await page.mouse.click(clickTarget.x, clickTarget.y);
  await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
  result.checks.regressionDetail = { opened: true };
} else {
  result.checks.regressionDetail = { opened: false, reason: 'no-visible-node' };
}
result.checks.nodeCountAfterSearch = pos.length;

// ---------- 6) 移动端搜索 ----------
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
await page.waitForTimeout(1200);
await page.keyboard.press('Control+k');
await searchInput().waitFor({ state: 'visible', timeout: 5_000 });
await searchInput().fill('网络');
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => {
  const panel = document.querySelector('[aria-label="搜索知识"]');
  const rect = panel?.getBoundingClientRect();
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    panel: rect ? { left: rect.left, right: rect.right, top: rect.top, width: rect.width } : null,
  };
});
result.checks.mobile = { ...mobile, noHorizontalOverflow: mobile.scrollWidth <= mobile.innerWidth };
await page.screenshot({ path: join(OUT, 'phase2-mobile-search.png') });

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase2-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
