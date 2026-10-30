/**
 * 阶段 1 实现侧验收（Lead）：全屏布局 / 顶栏 / 导航 / 图例 / 详情面板 / 单击双击 / 移动端 / fixture。
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

async function waitEngine(timeout = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ready = await page.evaluate(() => window.__kbGraphEngineStop !== undefined).catch(() => false);
    if (ready) return;
    await page.waitForTimeout(200);
  }
  throw new Error('引擎停止等待超时');
}

async function openGraph(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await loginIfNeeded();
  if (!page.url().includes('/graph')) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
  await waitEngine();
  await page.waitForTimeout(600);
}

const nodeScreen = () =>
  page.evaluate(() => {
    const fg = window.__kbGraphInstance;
    const positions = window.__kbGraphNodePositions ?? [];
    const canvas = document.querySelector('canvas');
    if (!fg || !canvas || positions.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    for (const pos of positions) {
      const pt = fg.graph2ScreenCoords(pos.x, pos.y);
      const x = rect.left + pt.x;
      const y = rect.top + pt.y;
      if (x < rect.left + 24 || x > rect.right - 24 || y < rect.top + 24 || y > rect.bottom - 24) continue;
      const el = document.elementFromPoint(x, y);
      if (!el || el.tagName !== 'CANVAS') continue;
      return { id: pos.id, x, y, canvas: { left: rect.left, top: rect.top, w: rect.width, h: rect.height } };
    }
    return null;
  });

async function singleClickNode(index = 0) {
  const target = await nodeScreen(index);
  if (!target) throw new Error('取不到节点坐标');
  await page.mouse.click(target.x, target.y);
  return target;
}

await openGraph(`${BASE}/graph`);
await page.screenshot({ path: join(OUT, 'phase1-desktop-default.png') });

// ---------- 1) 沉浸布局 / 顶栏 / 导航 / 图例 ----------
const layout = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  return {
    canvasTop: canvas?.getBoundingClientRect().top,
    canvasHeight: canvas?.getBoundingClientRect().height,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    navVisible: Boolean(nav),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
});
result.checks.immersive = {
  ...layout,
  canvasFill: layout.canvasHeight >= layout.viewport.h * 0.85,
  noPageScroll: layout.scrollWidth <= layout.innerWidth,
  sidebarHidden: !(await page.locator('aside').first().isVisible()),
  footerHidden: !(await page.locator('footer').first().isVisible()),
};
result.checks.topbar = {
  brand: await page.getByText('知识宇宙', { exact: true }).first().isVisible(),
  searchPlaceholder: await page.getByRole('button', { name: '搜索知识（Ctrl K）' }).textContent().catch(() => null),
  stats: await page.getByText(/15\s*知识点/).count(),
};
result.checks.nav = {
  items: await page.locator('nav[aria-label="知识宇宙导航"] [aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
  navCount: await page.locator('nav[aria-label="知识宇宙导航"]').count(),
};

// 图例：默认收起 → 展开 → 收起
const legendButton = page.getByRole('button', { name: '展开记忆度图例' });
result.checks.legendCollapsed = await legendButton.isVisible();
await legendButton.click();
result.checks.legendExpanded = (await page.getByRole('region', { name: '记忆度图例' }).count()) > 0;
await page.screenshot({ path: join(OUT, 'phase1-desktop-legend.png') });
await page.getByRole('button', { name: '收起记忆度图例' }).click();

// 设置面板（筛选 tab 仍可用）
await page.getByRole('button', { name: '关系图谱设置' }).click();
result.checks.settingsPanel = await page.getByText('记忆程度', { exact: true }).isVisible();
await page.getByRole('button', { name: '关系图谱设置' }).click();

// ---------- 2) 单击 → 详情面板 / 一阶高亮 / 编辑深链 ----------
await singleClickNode(0);
await page.locator('[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 5_000 });
await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(300);
const panelText = await page.locator('[aria-label="知识点详情"]').textContent();
result.checks.detailPanel = {
  visible: true,
  hasTitle: Boolean(panelText && panelText.length > 10),
  excerpt: panelText?.replace(/\s+/g, ' ').slice(0, 160),
  url: page.url(),
};
await page.screenshot({ path: join(OUT, 'phase1-desktop-detail.png') });

await page.getByRole('button', { name: '展开一阶关联' }).click();
await page.waitForTimeout(300);
result.checks.focus = {
  pressed: await page.getByRole('button', { name: '收起一阶关联' }).getAttribute('aria-pressed'),
};
await page.getByRole('button', { name: '收起一阶关联' }).click();

// 编辑 → /segments/{id}#edit 进入编辑态（页面会清 hash）
const editButton = page.getByRole('button', { name: '编辑知识点' });
if (await editButton.isVisible()) {
  await editButton.click();
  await page.waitForURL(/\/segments\//, { timeout: 15_000 });
  await page.getByRole('button', { name: /完成编辑/ }).waitFor({ state: 'visible', timeout: 20_000 });
  result.checks.editDeepLink = { url: page.url(), editingVisible: true };
  await page.screenshot({ path: join(OUT, 'phase1-edit-deeplink.png') });
}

// ---------- 3) 双击进入阅读 / 空白单击取消选中 ----------
await openGraph(`${BASE}/graph`);
const dblTarget = await nodeScreen(0);
await page.mouse.click(dblTarget.x, dblTarget.y);
await page.waitForTimeout(80);
await page.mouse.click(dblTarget.x, dblTarget.y);
await page.waitForURL(/\/segments\//, { timeout: 15_000 });
result.checks.doubleClick = { url: page.url(), noHash: !page.url().includes('#edit') };

await openGraph(`${BASE}/graph`);
await singleClickNode(0);
await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
const blankPoint = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + 8, y: rect.top + 8 };
});
await page.mouse.click(blankPoint.x, blankPoint.y);
await page.waitForTimeout(500);
result.checks.backgroundClick = {
  panelVisible: await page.locator('[aria-label="知识点详情"]').count(),
};

// ---------- 4) 双选模式仍为选择、不跳页 ----------
await page.getByRole('button', { name: '联系两概念' }).click();
await singleClickNode(1);
await page.waitForTimeout(500);
result.checks.compareMode = {
  url: page.url(),
  text: await page.getByText(/已选 \d\/2/).first().textContent().catch(() => null),
};
await page.getByRole('button', { name: '退出' }).click().catch(() => {});

// ---------- 5) fixture 压测模式 ----------
await openGraph(`${BASE}/graph?fixture=graph-small`);
await page.waitForTimeout(500);
result.checks.fixtureMode = {
  stats: await page.getByText(/500\s*知识点/).count(),
  rendered: await page.evaluate(() => window.__kbGraphNodePositions?.length ?? 0),
};
await page.screenshot({ path: join(OUT, 'phase1-desktop-fixture.png') });

// ---------- 6) 移动端 375×812 ----------
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
await waitEngine();
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  nav: Boolean(document.querySelector('nav[aria-label="知识宇宙导航"]')),
  navBottom: document.querySelector('nav[aria-label="知识宇宙导航"]')?.getBoundingClientRect().bottom,
  viewportH: window.innerHeight,
}));
result.checks.mobile = { ...mobile, noHorizontalOverflow: mobile.scrollWidth <= mobile.innerWidth };
await page.screenshot({ path: join(OUT, 'phase1-mobile-default.png') });
await singleClickNode(0);
await page.locator('[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 5_000 });
await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'phase1-mobile-detail.png') });
result.checks.mobileDetailVisible = true;

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase1-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
