/**
 * U4-3 学习地图实现侧验收（Lead）：四类标记、图例计数、记忆度颜色不变、移动端。
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
  if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(`${page.url()} :: ${m.text()}`.slice(0, 800));
});
let requestLog = [];
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
  await page.waitForTimeout(600);
}

const sampleNodeCenter = (index = 0) =>
  page.evaluate((idx) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    const pos = (window.__kbGraphNodePositions ?? [])[idx];
    if (!fg || !canvas || !pos) return null;
    const pt = fg.graph2ScreenCoords(pos.x, pos.y);
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const px = Math.round(pt.x * dpr);
    const py = Math.round(pt.y * dpr);
    const data = ctx.getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, index);

await login();
await waitGraph();

// 计算期望值（真实 API）
const expected = await page.evaluate(async () => {
  const [graph, today] = await Promise.all([
    fetch('/api/graph').then((r) => r.json()),
    fetch('/api/learning/today').then((r) => r.json()).catch(() => ({ items: [] })),
  ]);
  const adj = new Map();
  for (const edge of graph.edges ?? []) {
    for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a).add(b);
    }
  }
  const nodes = graph.nodes ?? [];
  const weak = nodes.filter((n) => n.memory < 0.4).length;
  const degrees = nodes
    .map((n) => ({ id: n.id, degree: adj.get(n.id)?.size ?? 0 }))
    .filter((d) => d.degree >= 2)
    .sort((a, b) => (b.degree === a.degree ? a.id.localeCompare(b.id) : b.degree - a.degree));
  const hub = Math.max(1, Math.ceil(degrees.length * 0.1));
  const due = (today.items ?? []).filter((i) => i.reasonCode === 'due-review').length;
  const todayCount = (today.items ?? []).filter((i) => i.reasonCode !== 'due-review').length;
  return { nodes: nodes.length, weak, hub, due, todayCount };
});
result.checks.expected = expected;

requestLog = [];
await page.getByRole('button', { name: /学习地图/ }).click();
await page.getByRole('button', { name: '地图', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
const panelLabels = await page.locator('[role="group"], label').allInnerTexts().catch(() => []);
await page.getByRole('button', { name: '全部显示' }).click();
await page.waitForTimeout(1200);
const todayRequests = requestLog.filter((url) => url.includes('/api/learning/today')).length;
result.checks.mapEnabled = {
  todayRequests,
  legend: await page.locator('div.absolute.bottom-8').innerText().catch(() => null),
  panelLabels: panelLabels.slice(0, 8),
};
await page.screenshot({ path: join(OUT, 'phase6-map-all.png') });

// 记忆度颜色不变：启用前后节点中心 RGB 相同（同一帧需 hover 触发重绘）
const beforeColor = await sampleNodeCenter(0);
await page.mouse.move(10, 990);
await page.waitForTimeout(300);
const afterColor = await sampleNodeCenter(0);
result.checks.colorUnchanged = { beforeColor, afterColor };

// 只保留薄弱
await page.getByRole('button', { name: '清除标记' }).click();
await page.waitForTimeout(300);
await page.locator('label', { hasText: '薄弱' }).locator('input[type="checkbox"]').check();
await page.waitForTimeout(600);
result.checks.weakOnly = {
  legend: await page.locator('div.absolute.bottom-8').innerText().catch(() => null),
};
await page.screenshot({ path: join(OUT, 'phase6-map-weak.png') });

// 移动端面板
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /学习地图/ }).click().catch(() => {});
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('div')].find((el) => el.textContent?.includes('学习地图用独立'));
  const rect = panel?.getBoundingClientRect();
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    panel: rect ? { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) } : null,
  };
});
result.checks.mobile = { ...mobile, noHorizontalOverflow: mobile.scrollWidth <= mobile.innerWidth };
await page.screenshot({ path: join(OUT, 'phase6-map-mobile.png') });

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase6-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
