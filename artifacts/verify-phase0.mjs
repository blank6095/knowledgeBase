/**
 * 阶段 0 实现侧验收（Lead）：U0-1 行为回归 + U0-3 背景分层验收 + U0-2 字段抽查。
 * 仅本地开发验证使用，结果与截图写入 artifacts/。
 *
 * 说明：force-graph 实例只暴露 graph2ScreenCoords 等相机 API，不暴露 graphData()；
 * 节点坐标以 GraphCanvas 在 onEngineStop 写入的只读快照 `__kbGraphNodePositions` 为准，
 * 并用 `__kbGraphEngineStop` 时间戳判断是否发生重排。
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

const envText = await readFile(join(process.cwd(), '.env.local'), 'utf8').catch(() => '');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const passcode = env.AUTH_PASSCODE;
if (!passcode) throw new Error('缺少 AUTH_PASSCODE（.env.local）');

const result = { base: BASE, checks: {}, consoleErrors: [], pageErrors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => result.pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(m.text().slice(0, 300));
});

const snapshot = () =>
  page.evaluate(() => ({
    positions: window.__kbGraphNodePositions ?? [],
    engineStop: window.__kbGraphEngineStop ?? null,
    firstTick: window.__kbGraphFirstTick ?? null,
  }));

async function waitFor(fn, timeout = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn).catch(() => undefined);
    if (v) return v;
    await page.waitForTimeout(200);
  }
  throw new Error('等待超时');
}

async function loginIfNeeded() {
  if (!page.url().includes('/login')) return;
  const input = page.getByPlaceholder('访问口令');
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const submit = page.getByRole('button', { name: '进入' });
  let enabled = false;
  for (let i = 0; i < 20 && !enabled; i += 1) {
    await input.fill(passcode);
    await page.waitForTimeout(300);
    enabled = await submit.isEnabled().catch(() => false);
  }
  if (!enabled) throw new Error('登录按钮不可用');
  await submit.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function openGraph(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await loginIfNeeded();
  if (!page.url().includes('/graph')) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
  await waitFor(() => typeof window.__kbGraphEngineStop !== 'undefined');
  await page.waitForTimeout(700);
}

/** 等待引擎再次停止（用于筛选后重排），返回新快照。 */
async function waitNextEngineStop(prevStop) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const s = await snapshot();
    if (s.engineStop !== null && s.engineStop !== prevStop) return s;
    await page.waitForTimeout(200);
  }
  return snapshot();
}

const screenCoordsOfNode = (nodePos) =>
  page.evaluate((pos) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    if (!fg || !canvas || !pos) return null;
    const pt = fg.graph2ScreenCoords(pos.x, pos.y);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + pt.x, y: rect.top + pt.y, id: pos.id };
  }, nodePos);

// ---------- 1) 默认图谱加载 / U0-2 字段 ----------
await openGraph(`${BASE}/graph`);
result.checks.loaded = await page.getByRole('heading', { name: '关系图谱' }).isVisible();
const initial = await snapshot();
result.checks.initial = {
  renderedNodes: initial.positions.length,
  engineStop: initial.engineStop,
  firstTick: initial.firstTick,
};

const payload = await page.evaluate(async () => {
  const res = await fetch('/api/graph');
  const json = await res.json();
  const n = json.nodes?.[0] ?? {};
  return {
    ok: res.ok,
    nodeCount: json.nodes?.length ?? 0,
    edgeCount: json.edges?.length ?? 0,
    keys: Object.keys(n).sort(),
    types: {
      tags: Array.isArray(n.tags) ? 'array' : typeof n.tags,
      summary: n.summary === null ? 'null' : typeof n.summary,
      headingPath: typeof n.headingPath,
      memory: typeof n.memory,
      documentTitle: n.documentTitle === null ? 'null' : typeof n.documentTitle,
    },
    sample: { id: n.id, title: n.title, headingPath: n.headingPath, tags: n.tags, summary: n.summary },
    nullSummary: json.nodes?.filter((x) => x.summary === null || x.summary === undefined).length ?? 0,
  };
});
result.checks.apiPayload = payload;
const required = ['documentTitle', 'headingPath', 'id', 'memory', 'readingMs', 'summary', 'tags', 'title', 'viewCount'];
result.checks.apiPayloadKeysOk = required.every((k) => payload.keys.includes(k));

await page.screenshot({ path: join(OUT, 'phase0-graph-deep-space.png') });

// ---------- 2) U0-3 背景切换：无请求、无重排 ----------
const before = await snapshot();
const requests = [];
const onReq = (req) => requests.push(req.url());
page.on('request', onReq);
await page.evaluate(() => {
  const el = document.querySelector('.graph-background');
  if (!el) throw new Error('缺少 .graph-background');
  el.dataset.graphEnv = 'minimal';
});
await page.waitForTimeout(700);
page.off('request', onReq);
const after = await snapshot();
result.checks.background = {
  switchedTo: await page.evaluate(() => document.querySelector('.graph-background')?.getAttribute('data-graph-env')),
  pointerEvents: await page.evaluate(() => getComputedStyle(document.querySelector('.graph-background')).pointerEvents),
  dataRequestsDuringSwitch: requests.filter((u) => u.includes('/api/graph') || u.includes('/fixtures/')),
  requestCountDuringSwitch: requests.length,
  engineStopUnchanged: before.engineStop === after.engineStop,
  positionsUnchanged: JSON.stringify(before.positions) === JSON.stringify(after.positions),
  nodeCount: after.positions.length,
};
await page.screenshot({ path: join(OUT, 'phase0-graph-minimal.png') });

// 恢复默认背景
await page.evaluate(() => {
  const el = document.querySelector('.graph-background');
  if (el) el.dataset.graphEnv = 'deep-space';
});

// ---------- 3) 悬停命中（背景层不拦截指针） ----------
const target = after.positions[0];
const screen = await screenCoordsOfNode(target);
if (screen) {
  await page.mouse.move(screen.x, screen.y);
  await page.waitForTimeout(500);
  const cursor = await page.evaluate(() => document.body.style.cursor);
  const tooltip = await page.evaluate(() => {
    const el = document.querySelector('.float-tooltip-kap');
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  });
  result.checks.hover = { moved: true, cursor, tooltip };
  await page.screenshot({ path: join(OUT, 'phase0-graph-hover.png') });
  await page.mouse.move(5, 5);
} else {
  result.checks.hover = { moved: false, reason: 'no-screen-coords' };
}

// ---------- 4) 设置面板 / 筛选 / 双选回归 ----------
const settingsBtn = page.getByRole('button', { name: '关系图谱设置' });
await settingsBtn.click();
result.checks.panelOpen = await page.getByText('记忆程度', { exact: true }).isVisible();
const tabs = {};
for (const tab of ['分组', '显示', '力', '筛选']) {
  await page.locator('button', { hasText: new RegExp(`^${tab}$`) }).first().click();
  await page.waitForTimeout(120);
  tabs[tab] = true;
}
result.checks.tabs = tabs;

const beforeFilter = (await snapshot()).engineStop;
const unreadLabel = page.locator('label', { hasText: '未读' }).first();
await unreadLabel.locator('input[type=checkbox]').uncheck();
const afterFilterSnap = await waitNextEngineStop(beforeFilter);
await unreadLabel.locator('input[type=checkbox]').check();
const restoredSnap = await waitNextEngineStop(afterFilterSnap.engineStop);
result.checks.filter = {
  beforeNodes: after.positions.length,
  afterUncheckUnreadNodes: afterFilterSnap.positions.length,
  engineRestarted: afterFilterSnap.engineStop !== beforeFilter,
  changed: afterFilterSnap.positions.length !== after.positions.length,
};
await settingsBtn.click();

// 双选模式：单击节点进入已选 1/2，不跳页
await page.getByRole('button', { name: '联系两概念' }).click();
const clickTarget = await screenCoordsOfNode(restoredSnap.positions[1] ?? restoredSnap.positions[0]);
if (clickTarget) {
  await page.mouse.click(clickTarget.x, clickTarget.y);
  await page.waitForTimeout(400);
  result.checks.compareMode = {
    url: page.url(),
    compareText: await page
      .getByText(/已选 \d\/2/)
      .first()
      .textContent()
      .catch(() => null),
  };
  await page.getByRole('button', { name: '退出' }).click().catch(() => {});
  // 等 React 完成 compareMode=false 的状态提交，避免下一次点击仍走双选分支
  await page.waitForTimeout(400);
} else {
  result.checks.compareMode = { ok: false };
}

// 普通模式：单击节点跳转到知识点详情（重构前语义）。为排除双选状态的时序干扰，先重载页面。
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
await waitFor(() => typeof window.__kbGraphEngineStop !== 'undefined');
await page.waitForTimeout(500);
const freshSnap = await snapshot();
const normalTarget = await screenCoordsOfNode(freshSnap.positions[0]);
if (normalTarget) {
  await page.mouse.click(normalTarget.x, normalTarget.y);
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000 && !/\/segments\//.test(page.url())) await page.waitForTimeout(200);
  result.checks.normalClickNavigation = page.url();
} else {
  result.checks.normalClickNavigation = 'no-target';
}

// ---------- 5) fixture 压测模式回归 ----------
await page.goto(`${BASE}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 120_000 });
await waitFor(() => typeof window.__kbGraphEngineStop !== 'undefined', 120_000);
const fixtureInfo = await page.evaluate(async () => {
  const res = await fetch('/fixtures/graph-small.json');
  const json = await res.json();
  return { fixtureNodes: json.nodes.length, hasBadge: document.body.textContent.includes('压测数据模式：graph-small') };
});
const fixtureSnap = await snapshot();
result.checks.fixtureMode = { ...fixtureInfo, renderedNodes: fixtureSnap.positions.length };
await page.screenshot({ path: join(OUT, 'phase0-graph-fixture-small.png') });

result.consoleErrors = result.consoleErrors.slice(0, 5);
result.pageErrors = result.pageErrors.slice(0, 5);
await writeFile(join(OUT, 'phase0-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
