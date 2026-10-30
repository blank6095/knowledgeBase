/**
 * 阶段 4（部分）实现侧验收（Lead）：U4-1 一/二阶关联、U4-2 双节点路径、U4-5 右键/长按菜单。
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

async function openGraph(url = `${BASE}/graph`) {
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

/** 可点击（在 canvas 命中且不在浮层下）的节点列表。 */
const clickableNodes = () =>
  page.evaluate(() => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    if (!fg || !canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const out = [];
    for (const item of window.__kbGraphNodePositions ?? []) {
      const pt = fg.graph2ScreenCoords(item.x, item.y);
      const x = rect.left + pt.x;
      const y = rect.top + pt.y;
      if (x < rect.left + 30 || x > rect.right - 30 || y < rect.top + 90 || y > rect.bottom - 120) continue;
      if (document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
      out.push({ id: item.id, x, y });
    }
    return out;
  });

const mouseClickNode = async (node, button = 'left') => {
  await page.mouse.click(node.x, node.y, { button });
};

await openGraph();
await page.screenshot({ path: join(OUT, 'phase4-desktop-default.png') });
const clickable = await clickableNodes();
result.checks.clickableNodes = clickable.length;

// ---------- U4-1 一阶/二阶/收起循环 ----------
await mouseClickNode(clickable[0]);
await page.getByRole('button', { name: '阅读知识' }).waitFor({ state: 'visible', timeout: 20_000 });
const focusButton = () => page.getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
const focusLabels = [];
focusLabels.push(await focusButton().textContent());
await focusButton().click();
await page.waitForTimeout(400);
focusLabels.push(await focusButton().textContent());
result.checks.focusDepth1 = { label: focusLabels[1], pressed: await focusButton().getAttribute('aria-pressed') };
await page.screenshot({ path: join(OUT, 'phase4-focus-1hop.png') });
await focusButton().click();
await page.waitForTimeout(400);
focusLabels.push(await focusButton().textContent());
result.checks.focusDepth2 = { label: focusLabels[2], pressed: await focusButton().getAttribute('aria-pressed') };
await page.screenshot({ path: join(OUT, 'phase4-focus-2hop.png') });
await focusButton().click();
await page.waitForTimeout(300);
focusLabels.push(await focusButton().textContent());
result.checks.focusCycle = focusLabels;

// 关闭详情面板
await page.getByRole('button', { name: '关闭详情' }).click().catch(() => {});
await page.waitForTimeout(300);

// ---------- U4-2 双节点路径 ----------
const pairs = await page.evaluate(() => {
  const fg = window.__kbGraphInstance;
  const canvas = document.querySelector('canvas');
  if (!fg || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const clickable = [];
  for (const item of window.__kbGraphNodePositions ?? []) {
    const pt = fg.graph2ScreenCoords(item.x, item.y);
    const x = rect.left + pt.x;
    const y = rect.top + pt.y;
    if (x < rect.left + 30 || x > rect.right - 30 || y < rect.top + 90 || y > rect.bottom - 150) continue;
    if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') clickable.push({ id: item.id, x, y });
  }
  return clickable;
});

async function comparePair(a, b, tag) {
  // 上一次交互可能残留详情面板/误触导航，先恢复到图谱页并收起面板
  if (!/\/graph(\?|$)/.test(page.url())) await openGraph();
  if ((await page.locator('[aria-label="知识点详情"]').count()) > 0) {
    await page.getByRole('button', { name: '关闭详情' }).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const barLocator = () => page.getByText(/^已选 \d\/2/).first();
  // 若上一组仍处于双选态，先退出，避免把「联系两概念」再次点成关闭
  if (await barLocator().isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '退出', exact: true }).click().catch(() => {});
    await barLocator().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: '联系两概念' }).click();
  await barLocator().waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(250);
  await mouseClickNode(a);
  await page.waitForTimeout(300);
  await mouseClickNode(b);
  await page.getByText(/已选 2\/2/).first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const bar = await page.getByText(/已选 2\/2/).first().textContent().catch(() => null);
  const pathText = await page.getByText(/^路径：|两个知识点之间没有路径/).first().textContent().catch(() => null);
  const body = await page.locator('body').innerText();
  result.checks[tag] = { bar, pathText, hasPathToggle: body.includes('清除路径') || body.includes('高亮路径'), url: page.url() };
  await page.screenshot({ path: join(OUT, `phase4-${tag}.png`) });
  await page.getByRole('button', { name: '退出', exact: true }).click().catch(() => {});
  await barLocator().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

// 用 API 找直接/间接/无路径三组节点（在浏览器上下文里做 BFS）
const pairSets = await page.evaluate((clickables) => {
  return fetch('/api/graph')
    .then((res) => res.json())
    .then((json) => {
      const adj = new Map();
      for (const edge of json.edges ?? []) {
        const s = edge.source;
        const t = edge.target;
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s).add(t);
        adj.get(t).add(s);
      }
      const bfs = (start) => {
        const d = new Map([[start, 0]]);
        const q = [start];
        while (q.length) {
          const cur = q.shift();
          for (const next of adj.get(cur) ?? []) {
            if (!d.has(next)) {
              d.set(next, d.get(cur) + 1);
              q.push(next);
            }
          }
        }
        return d;
      };
      const byId = new Map(clickables.map((c) => [c.id, c]));
      let direct = null;
      let indirect = null;
      let none = null;
      for (let i = 0; i < clickables.length && (!direct || !indirect); i += 1) {
        const a = clickables[i];
        const d = bfs(a.id);
        for (let j = i + 1; j < clickables.length; j += 1) {
          const b = clickables[j];
          const dd = d.get(b.id);
          if (dd === 1 && !direct) direct = { a: byId.get(a.id), b: byId.get(b.id) };
          if (dd >= 2 && dd <= 4 && !indirect) indirect = { a: byId.get(a.id), b: byId.get(b.id) };
        }
      }
      for (let i = 0; i < clickables.length && !none; i += 1) {
        for (let j = i + 1; j < clickables.length; j += 1) {
          if (!bfs(clickables[i].id).has(clickables[j].id)) {
            none = { a: clickables[i], b: clickables[j] };
            break;
          }
        }
      }
      return { direct, indirect, none };
    });
}, pairs ?? []);

if (pairSets.direct) await comparePair(pairSets.direct.a, pairSets.direct.b, 'pathDirect');
if (pairSets.indirect) await comparePair(pairSets.indirect.a, pairSets.indirect.b, 'pathIndirect');
if (pairSets.none) await comparePair(pairSets.none.a, pairSets.none.b, 'pathNone');

// ---------- U4-5 右键菜单 ----------
const menuNode = (await clickableNodes())[0];
await mouseClickNode(menuNode, 'right');
await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5_000 });
const menuItems = await page.getByRole('menuitem').allInnerTexts();
result.checks.contextMenu = { visible: true, itemCount: menuItems.length, items: menuItems.slice(0, 8) };
await page.screenshot({ path: join(OUT, 'phase4-context-menu.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
result.checks.contextMenuClosed = (await page.getByRole('menu').count()) === 0;

// 从菜单展开二阶
await mouseClickNode(menuNode, 'right');
await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5_000 });
await page.getByRole('menuitem', { name: '展开二阶关联' }).click();
await page.waitForTimeout(500);
const detailVisible = await page.locator('[aria-label="知识点详情"]').isVisible().catch(() => false);
result.checks.menuAction = {
  detailVisible,
  focusLabel: await page.getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ }).textContent().catch(() => null),
};
await page.screenshot({ path: join(OUT, 'phase4-menu-second-order.png') });
await page.getByRole('button', { name: '关闭详情' }).click().catch(() => {});

// ---------- 移动端长按 ----------
await page.setViewportSize({ width: 375, height: 812 });
await openGraph();
const mobileNodes = await clickableNodes();
if (mobileNodes.length > 0) {
  const target = mobileNodes[0];
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas');
    for (const type of ['pointerdown']) {
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }));
    }
  }, target);
  await page.waitForTimeout(700);
  result.checks.mobileLongPress = { menuVisible: (await page.getByRole('menu').count()) > 0 };
  if (result.checks.mobileLongPress.menuVisible) {
    await page.screenshot({ path: join(OUT, 'phase4-mobile-menu.png') });
  }
} else {
  result.checks.mobileLongPress = { menuVisible: false, reason: 'no-clickable-node' };
}

result.consoleErrors = result.consoleErrors.slice(0, 8);
result.pageErrors = result.pageErrors.slice(0, 8);
await writeFile(join(OUT, 'phase4-lead-verify.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
