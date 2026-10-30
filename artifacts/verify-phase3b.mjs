/**
 * 阶段 3 补充验收：U4-4 AI 上下文 chips/请求体、图谱入口接线、全站页脚布局。
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

await login();
// 取两个真实 segment id
const ids = await page.evaluate(async () => {
  const res = await fetch('/api/graph');
  const json = await res.json();
  return (json.nodes ?? []).slice(0, 2).map((n) => n.id);
});
result.checks.ids = ids;

// ---------- U4-4 单节点上下文 ----------
let postedBody = null;
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/api/ai/ask')) postedBody = req.postData();
});
await page.goto(`${BASE}/ask?segment=${ids[0]}`, { waitUntil: 'domcontentloaded' });
await page.getByText('当前上下文').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForSelector('[aria-label^="移除上下文"]', { timeout: 25_000 });
const single = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('[aria-label^="移除上下文"]')].map((el) => el.getAttribute('aria-label')),
  bodyText: document.body.innerText.slice(0, 400),
  inputPlaceholder: document.querySelector('main input')?.getAttribute('placeholder') ?? null,
}));
result.checks.single = single;
await page.screenshot({ path: join(OUT, 'phase3-ask-segment.png') });

// 填一个 query，点发送（不依赖模型真实返回，只校验请求体）
const input = page.locator('main input').first();
await input.fill('解释这个知识点');
const askButton = page.getByRole('button', { name: '发送', exact: true }).first();
if (await askButton.isVisible().catch(() => false)) {
  await askButton.click().catch(() => {});
  await page.waitForTimeout(1500);
}
result.checks.requestBody = postedBody;

// ---------- 非法 id ----------
await page.goto(`${BASE}/ask?segment=not-a-uuid`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
result.checks.invalid = {
  contextHeading: await page.getByText('当前上下文').count(),
  chips: await page.locator('[aria-label^="移除上下文"]').count(),
};

// ---------- 路径上下文 ----------
await page.goto(`${BASE}/ask?path=${ids.join(',')}`, { waitUntil: 'domcontentloaded' });
await page.getByText('当前上下文').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForSelector('[aria-label^="移除上下文"]', { timeout: 25_000 });
result.checks.path = await page.evaluate(() => ({
  chips: document.querySelectorAll('[aria-label^="移除上下文"]').length,
  suggestion: document.querySelector('main input')?.value ?? '',
}));
await page.screenshot({ path: join(OUT, 'phase3-ask-path.png') });

// ---------- 清空 / 移除 chip（QA 红项回归） ----------
await page.getByRole('button', { name: /全部清除/ }).click();
await page.waitForTimeout(1500);
result.checks.clearChips = await page.evaluate(() => ({
  url: window.location.pathname + window.location.search,
  loading: document.querySelectorAll('[aria-label="当前上下文加载中"]').length,
  chips: document.querySelectorAll('[aria-label^="移除上下文"]').length,
  contextSection: document.querySelectorAll('section[aria-label="当前上下文"]').length,
}));

await page.goto(`${BASE}/ask?path=${ids.join(',')}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[aria-label^="移除上下文"]', { timeout: 25_000 });
await page.locator('[aria-label^="移除上下文"]').first().click();
await page.waitForTimeout(1500);
result.checks.removeChip = await page.evaluate(() => ({
  url: window.location.pathname + window.location.search,
  loading: document.querySelectorAll('[aria-label="当前上下文加载中"]').length,
  chips: document.querySelectorAll('[aria-label^="移除上下文"]').length,
}));

// ---------- 图谱入口接线 ----------
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await waitGraph();
const node = await page.evaluate(() => {
  const fg = window.__kbGraphInstance;
  const c = document.querySelector('canvas').getBoundingClientRect();
  for (const item of window.__kbGraphNodePositions ?? []) {
    const p = fg.graph2ScreenCoords(item.x, item.y);
    const x = c.left + p.x;
    const y = c.top + p.y;
    if (x < c.left + 30 || x > c.right - 30 || y < c.top + 90 || y > c.bottom - 150) continue;
    if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y };
  }
  return null;
});
await page.mouse.click(node.x, node.y);
await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
await page.getByRole('button', { name: 'AI 解释' }).click();
await page.waitForURL((u) => u.pathname === '/ask', { timeout: 15_000 });
result.checks.detailAskUrl = page.url();

// ---------- 页脚不再悬在内容中间（非沉浸页 main flex-1） ----------
await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
result.checks.notesFooter = await page.evaluate(() => {
  const footer = document.querySelector('footer');
  return { footerTop: footer?.getBoundingClientRect().top ?? null, viewportH: window.innerHeight };
});

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase3-ask-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
