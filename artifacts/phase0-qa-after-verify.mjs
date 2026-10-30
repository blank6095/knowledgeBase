/**
 * 阶段 0 出口门禁 · 改动后独立验证脚本 v2（QA，只读源码，只写 artifacts/）。
 *
 * 修正 v1 的脚本 bug：force-graph 实例只暴露 graph2ScreenCoords 等相机 API，
 * **没有 graphData()**；节点坐标一律取 GraphCanvas 在 onEngineStop 写入的
 * 只读快照 `window.__kbGraphNodePositions`，用 `__kbGraphEngineStop` 判断是否重排。
 *
 * 覆盖：
 *  1) /api/graph 契约：真实请求 + tags/summary/headingPath 类型与空值率
 *  2) 背景分层：切换 data-graph-env 前后无数据请求、坐标快照与引擎时间戳不变、
 *     pointer-events:none、Canvas 透明、deep-space/minimal 两侧 hover 均命中
 *  3) 回归清单：筛选、记忆度档、关联类型、分组、箭头、暂停、滑块、双选 + AI 浮层、
 *     普通单击跳转、拖拽、?fixture=graph-small、加载骨架、空态、console/page error
 *
 * 用法：$env:KB_PASSCODE 由外部注入；node artifacts/phase0-qa-after-verify.mjs
 * 依赖已启动的 dev server：http://127.0.0.1:3102
 */
import { chromium, request } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    record(name, true, await fn());
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function poll(fn, timeout, interval = 250) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

const snapshot = (page) =>
  page.evaluate(() => ({
    positions: window.__kbGraphNodePositions ?? [],
    engineStop: window.__kbGraphEngineStop ?? null,
  }));

async function waitEngineStop(page, timeout = 90_000) {
  const snap = await poll(async () => {
    const s = await snapshot(page);
    return s.positions.length > 0 && typeof s.engineStop === 'number' ? s : undefined;
  }, timeout);
  assert(snap, '等待 __kbGraphNodePositions / __kbGraphEngineStop 超时');
  await page.waitForTimeout(300);
  return snapshot(page);
}

async function waitNextEngineStop(page, prevStop, timeout = 45_000) {
  const snap = await poll(async () => {
    const s = await snapshot(page);
    return s.engineStop !== null && s.engineStop !== prevStop ? s : undefined;
  }, timeout);
  return snap ?? (await snapshot(page));
}

/** 用节点图坐标 + 相机 API 换算到视口坐标（force-graph 实例只可靠暴露 graph2ScreenCoords）。 */
async function screenPointOfNode(page, pos) {
  if (!pos) return null;
  return page.evaluate(({ x, y, id }) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    if (!fg || !canvas || typeof fg.graph2ScreenCoords !== 'function') return null;
    const pt = fg.graph2ScreenCoords(x, y);
    const rect = canvas.getBoundingClientRect();
    return { id, x: rect.left + pt.x, y: rect.top + pt.y };
  }, pos);
}

/** hover 命中：cursor=pointer + tooltip 文案非空。 */
async function hoverCheck(page, pos) {
  await page.mouse.move(4, 4);
  const pt = await screenPointOfNode(page, pos);
  assert(pt, '无法换算节点屏幕坐标');
  await page.mouse.move(pt.x, pt.y, { steps: 5 });
  const cursor = await poll(
    () => page.evaluate(() => (document.body.style.cursor === 'pointer' ? 'pointer' : undefined)),
    8_000,
  );
  assert(cursor === 'pointer', `cursor=${cursor}`);
  const tooltip = await poll(
    () =>
      page.evaluate(() => {
        const el = document.querySelector('.float-tooltip-kap');
        const text = el?.textContent?.replace(/\s+/g, ' ').trim();
        return text ? text.slice(0, 120) : undefined;
      }),
    8_000,
  );
  assert(tooltip, 'tooltip 文案为空');
  return `cursor=pointer tooltip="${tooltip}"`;
}

function trackDataRequests(page) {
  const hits = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/graph(\?|$)|\/fixtures\/[^/]+\.json/.test(url)) hits.push({ url, at: Date.now() });
  });
  return hits;
}

const maxDelta = (a, b) => {
  const mapB = new Map(b.map((n) => [n.id, n]));
  let max = 0;
  for (const node of a) {
    const other = mapB.get(node.id);
    if (!other) return Number.POSITIVE_INFINITY;
    max = Math.max(max, Math.abs(node.x - other.x), Math.abs(node.y - other.y));
  }
  return max;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 900 } });

try {
  // ---------- 1. /api/graph 契约（真实请求，共享登录 cookie） ----------
  const api = await request.newContext({ baseURL });
  const unauth = await api.get('/api/graph');
  await check('契约：未登录 GET /api/graph 被拒（401/403）', async () => {
    assert([401, 403].includes(unauth.status()), `未登录返回 ${unauth.status()}`);
    return `status=${unauth.status()}`;
  });

  const loginRes = await api.post('/api/auth/login', { data: { passcode } });
  await check('契约：口令登录成功', async () => {
    assert(loginRes.ok(), `login status=${loginRes.status()}`);
    return 'status=200 + httpOnly cookie';
  });

  const t0 = Date.now();
  const graphRes = await api.get('/api/graph');
  const elapsedMs = Date.now() - t0;
  const payload = await graphRes.json();
  await check('契约：GET /api/graph 200 且返回 nodes/edges', async () => {
    assert(graphRes.ok(), `status=${graphRes.status()}`);
    assert(Array.isArray(payload.nodes), 'nodes 不是数组');
    assert(Array.isArray(payload.edges), 'edges 不是数组');
    return `status=200 x-cache=${graphRes.headers()['x-cache']} nodes=${payload.nodes.length} edges=${payload.edges.length} ${elapsedMs}ms`;
  });

  await check('契约：每个节点都有 tags/summary/headingPath 且类型正确', async () => {
    const bad = [];
    for (const node of payload.nodes) {
      const problems = [];
      if (!Array.isArray(node.tags)) problems.push('tags 非数组');
      else if (node.tags.some((t) => typeof t !== 'string')) problems.push('tags 含非字符串');
      if (!(node.summary === null || typeof node.summary === 'string')) problems.push('summary 非 string|null');
      if (typeof node.headingPath !== 'string') problems.push('headingPath 非 string');
      if (typeof node.id !== 'string' || !node.id) problems.push('id 非法');
      if (typeof node.title !== 'string') problems.push('title 非 string');
      if (typeof node.memory !== 'number' || node.memory < 0 || node.memory > 1) problems.push('memory 不在 [0,1]');
      if (problems.length) bad.push({ id: node.id, problems });
    }
    assert(bad.length === 0, `存在不合规节点 ${JSON.stringify(bad.slice(0, 3))}`);
    return `${payload.nodes.length} 个节点字段全合规`;
  });

  await check('契约：扩展字段空值率（本地库实测）', async () => {
    const n = payload.nodes.length;
    const emptyTags = payload.nodes.filter((x) => (x.tags ?? []).length === 0).length;
    const nullSummary = payload.nodes.filter((x) => x.summary === null).length;
    const emptyHeading = payload.nodes.filter((x) => !x.headingPath).length;
    return `nodes=${n} tags空=${emptyTags}(${((emptyTags / n) * 100).toFixed(0)}%) summary为null=${nullSummary}(${((nullSummary / n) * 100).toFixed(0)}%) headingPath空=${emptyHeading}(${((emptyHeading / n) * 100).toFixed(0)}%)`;
  });

  await check('契约：edges 字段类型正确', async () => {
    for (const edge of payload.edges) {
      assert(typeof edge.kind === 'string' && edge.kind, 'edge.kind 非法');
      assert(typeof edge.weight === 'number', 'edge.weight 非 number');
      assert(typeof edge.source === 'string' || typeof edge.source === 'object', 'edge.source 非法');
      assert(typeof edge.target === 'string' || typeof edge.target === 'object', 'edge.target 非法');
    }
    return `${payload.edges.length} 条边字段合规`;
  });

  await check('契约：X-Cache 为 MISS/HIT 且命中缓存不改变结构', async () => {
    const hit = await api.get('/api/graph');
    const header = hit.headers()['x-cache'];
    assert(['HIT', 'MISS', 'STALE'].includes(header), `X-Cache=${header}`);
    const body = await hit.json();
    assert(JSON.stringify(body) === JSON.stringify(payload), '缓存与首次响应不一致');
    return `x-cache=${header}，响应体与首次一致`;
  });

  // ---------- 2. 浏览器登录 + 背景分层验收 ----------
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text().slice(0, 300));
  });
  const dataRequests = trackDataRequests(page);

  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`, { timeout: 30_000 });

  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '关系图谱' }).waitFor({ timeout: 60_000 });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  const base = await waitEngineStop(page);

  await check('背景：默认环境为 deep-space，画布渲染出节点', async () => {
    const env = await page.evaluate(() => document.querySelector('.graph-background')?.dataset.graphEnv);
    assert(env === 'deep-space', `data-graph-env=${env}`);
    assert(base.positions.length > 0, '坐标快照为空');
    return `data-graph-env=${env}，节点 ${base.positions.length} 个，engineStop=${Math.round(base.engineStop)}ms`;
  });

  await check('背景：背景层 pointer-events 为 none（不拦截画布交互）', async () => {
    const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.graph-background')).pointerEvents);
    assert(pe === 'none', `pointer-events=${pe}`);
    return 'pointer-events: none';
  });

  await check('背景：Canvas 背景透明（角落像素 alpha=0，底色/纹理层可见）', async () => {
    const alpha = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      return ctx.getImageData(canvas.width - 3, canvas.height - 3, 1, 1).data[3];
    });
    assert(alpha === 0, `角落像素 alpha=${alpha}`);
    return 'corner alpha=0';
  });

  await check('背景：deep-space 下节点 hover 命中（cursor=pointer + tooltip）', () => hoverCheck(page, base.positions[0]));
  await page.screenshot({ path: 'artifacts/phase0-qa-after-bg-deep-space.png' });

  // 切换前静默窗口：确认页面本身不再发数据请求
  const idleStart = Date.now();
  await page.waitForTimeout(1_000);
  const idleCount = dataRequests.filter((r) => r.at >= idleStart).length;

  const switchStart = Date.now();
  await page.evaluate(() => {
    document.querySelector('.graph-background').dataset.graphEnv = 'minimal';
  });
  await page.waitForTimeout(1_200);
  const switchEnd = Date.now();

  const envAfter = await page.evaluate(() => document.querySelector('.graph-background').dataset.graphEnv);
  const afterStyle = await page.evaluate(() => {
    const el = document.querySelector('.graph-background');
    return {
      pointerEvents: getComputedStyle(el).pointerEvents,
      beforeOpacity: getComputedStyle(el, '::before').opacity,
      afterOpacity: getComputedStyle(el, '::after').opacity,
      afterBackground: getComputedStyle(el, '::after').backgroundImage,
    };
  });
  const after = await snapshot(page);
  const switchRequests = dataRequests.filter((r) => r.at > switchStart && r.at <= switchEnd);
  const delta = maxDelta(base.positions, after.positions);
  await page.screenshot({ path: 'artifacts/phase0-qa-after-bg-minimal.png' });

  await check('背景：切换 minimal 后属性生效且纹理层关闭', async () => {
    assert(envAfter === 'minimal', `data-graph-env=${envAfter}`);
    assert(afterStyle.afterOpacity === '0', `::after opacity=${afterStyle.afterOpacity}`);
    assert(afterStyle.afterBackground === 'none', `::after background=${afterStyle.afterBackground}`);
    assert(afterStyle.pointerEvents === 'none', `pointer-events=${afterStyle.pointerEvents}`);
    return `env=${envAfter} ::after opacity=0 background=none pointer-events=none`;
  });

  await check('背景：切换期间无 /api/graph 或 /fixtures 数据请求', async () => {
    assert(switchRequests.length === 0, `切换窗口出现 ${JSON.stringify(switchRequests)}`);
    return `切换窗口请求数=0（切换前 1s 静默窗口=${idleCount}）`;
  });

  await check('背景：切换前后节点坐标与引擎停止时间戳不变', async () => {
    assert(base.positions.length === 15, `节点数=${base.positions.length}（期望本地库 15）`);
    assert(delta < 1e-9, `坐标最大偏移=${delta}`);
    assert(after.engineStop === base.engineStop, `引擎停止时间戳变化 ${base.engineStop} → ${after.engineStop}`);
    assert(JSON.stringify(after.positions) === JSON.stringify(base.positions), '坐标快照 JSON 不一致');
    return `nodeCount=${after.positions.length} maxDelta=${delta} engineStop 未变（${Math.round(base.engineStop)}ms）`;
  });

  await check('背景：minimal 下节点 hover 仍命中（cursor=pointer + tooltip）', () => hoverCheck(page, base.positions[0]));

  await page.evaluate(() => {
    document.querySelector('.graph-background').dataset.graphEnv = 'deep-space';
  });
  await page.waitForTimeout(800);
  const restored = await snapshot(page);
  await check('背景：切回 deep-space 后坐标仍不变', async () => {
    const d = maxDelta(base.positions, restored.positions);
    assert(d < 1e-9, `坐标最大偏移=${d}`);
    assert(restored.engineStop === base.engineStop, '切回后引擎停止时间戳变化');
    return `maxDelta=${d}，engineStop 未变`;
  });

  // ---------- 3. 工具栏与回归清单 ----------
  const openPanel = async () => {
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.getByRole('button', { name: '筛选', exact: true }).waitFor({ timeout: 10_000 });
  };

  await check('回归：设置面板打开，四个页签齐全', async () => {
    await openPanel();
    for (const tab of ['筛选', '分组', '显示', '力']) {
      assert(await page.getByRole('button', { name: tab, exact: true }).isVisible(), `${tab} 页签不可见`);
    }
    return '筛选/分组/显示/力 均可见';
  });

  await check('回归：筛选—标题搜索输入可用', async () => {
    const input = page.getByPlaceholder('搜索标题：命中高亮，其余淡化');
    await input.fill('记忆');
    await page.waitForTimeout(300);
    const value = await input.inputValue();
    assert(value === '记忆', `输入值=${value}`);
    await input.fill('');
    return '输入生效并可清空（画布淡化由 Canvas 绘制，见截图/代码审阅）';
  });

  await check('回归：记忆度档与关联类型复选框可切换', async () => {
    const boxes = page.locator('input[type="checkbox"]');
    const total = await boxes.count();
    assert(total >= 6, `复选框数量=${total}`);
    const first = boxes.first();
    const before = await first.isChecked();
    await first.click();
    assert((await first.isChecked()) !== before, '点击后勾选状态未变化');
    await first.click();
    assert((await first.isChecked()) === before, '二次点击未复原');
    return `复选框 ${total} 个（记忆度 + 关联类型），勾选可切换并复原`;
  });

  await check('回归：分组—新增与删除关键词分组', async () => {
    await page.getByRole('button', { name: '分组', exact: true }).click();
    await page.getByPlaceholder('关键词…').fill('记忆');
    await page.getByRole('button', { name: '添加' }).click();
    const row = page.locator('input[value="记忆"]');
    await row.waitFor({ timeout: 5_000 });
    await page.locator('button[aria-label="删除分组"]').last().click();
    await page.waitForTimeout(200);
    assert((await row.count()) === 0, '分组未删除');
    return '新增后出现分组行，删除后移除';
  });

  await check('回归：显示—箭头开关 / 暂停按钮 / 三个视觉滑块', async () => {
    await page.getByRole('button', { name: '显示', exact: true }).click();
    const arrowBox = page.locator('label', { hasText: '连线方向箭头' }).locator('input[type="checkbox"]');
    const before = await arrowBox.isChecked();
    await arrowBox.click();
    assert((await arrowBox.isChecked()) !== before, '箭头开关未切换');
    const pause = page.getByRole('button', { name: /暂停动画|继续动画/ });
    const pauseText = (await pause.innerText()).trim();
    await pause.click();
    const pausedText = (await pause.innerText()).trim();
    assert(pausedText !== pauseText, '暂停按钮文案未变化');
    await pause.click();
    const sliders = page.locator('input[type="range"]');
    assert((await sliders.count()) >= 3, `range 数量=${await sliders.count()}`);
    return `箭头切换 OK；暂停按钮「${pauseText} → ${pausedText}」；滑块 ${await sliders.count()} 个`;
  });

  await check('回归：力—四个滑块且拖动即时生效', async () => {
    await page.getByRole('button', { name: '力', exact: true }).click();
    const sliders = page.locator('input[type="range"]');
    assert((await sliders.count()) === 4, `力滑块数量=${await sliders.count()}`);
    await sliders.nth(1).evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '220');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const shown = await page.locator('label', { hasText: '斥力' }).first().innerText();
    assert(shown.includes('220'), `斥力显示=${shown.replace(/\s+/g, ' ')}`);
    return '4 个滑块，斥力改为 220 后显示同步（applyForces 生效）';
  });

  // ---------- 4. 双选 + AI 浮层（重载到干净状态） ----------
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  const forCompare = await waitEngineStop(page);
  const [a, b] = forCompare.positions;

  await check('回归：双选—选两个节点出现「已选 2/2」且不跳页', async () => {
    await page.getByRole('button', { name: '联系两概念' }).click();
    await page.getByText(/已选 0\/2/).waitFor({ timeout: 5_000 });
    const pa = await screenPointOfNode(page, a);
    const pb = await screenPointOfNode(page, b);
    await page.mouse.click(pa.x, pa.y);
    await page.getByText(/已选 1\/2/).waitFor({ timeout: 5_000 });
    assert(page.url().includes('/graph'), `单击后 URL 变了：${page.url()}`);
    await page.mouse.click(pb.x, pb.y);
    await page.getByText(/已选 2\/2/).waitFor({ timeout: 5_000 });
    assert(page.url().includes('/graph'), `第二次单击后 URL 变了：${page.url()}`);
    await page.screenshot({ path: 'artifacts/phase0-qa-after-compare.png' });
    return `已选 1/2 → 2/2，URL 保持 /graph（${new URL(page.url()).pathname}）`;
  });

  await check('回归：双选→解释关联→AiOverlay 打开并可关闭（拦截 /api/ai/connect）', async () => {
    await page.route('**/api/ai/connect', (route) =>
      route.fulfill({
        json: {
          explanation: '**示例解释**：两个概念通过共同文档相连。',
          segments: [
            { id: a.id, title: '概念 A', documentTitle: '示例文档' },
            { id: b.id, title: '概念 B', documentTitle: '示例文档' },
          ],
          contextUsed: {},
        },
      }),
    );
    await page.getByRole('button', { name: '解释关联' }).click();
    const dialog = page.locator('[role="dialog"][aria-label="两个概念如何联系"]');
    await dialog.waitFor({ timeout: 15_000 });
    const text = (await dialog.innerText()).replace(/\s+/g, ' ');
    assert(text.includes('示例解释'), `浮层未渲染解释：${text.slice(0, 60)}`);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 5_000 });
    await page.getByRole('button', { name: '退出', exact: true }).click().catch(() => {});
    return `AiOverlay 打开并关闭（含「${text.slice(0, 20)}…」）`;
  });

  // ---------- 5. 普通单击跳转 ----------
  await check('回归：普通单击节点跳转 /segments/<id>', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    const fresh = await waitEngineStop(page);
    const target = fresh.positions[0];
    const pt = await screenPointOfNode(page, target);
    assert(pt, '无法换算节点屏幕坐标');
    await page.mouse.click(pt.x, pt.y);
    await poll(() => Promise.resolve(page.url().includes('/segments/')), 15_000);
    assert(page.url().includes(`/segments/${target.id}`), `点击后 URL=${page.url()}`);
    return `跳转到 /segments/${target.id.slice(0, 8)}…`;
  });

  // ---------- 6. 拖拽 ----------
  await check('回归：拖拽节点后重排并产生新坐标快照', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    const before = await waitEngineStop(page);
    const target = before.positions[0];
    const pt = await screenPointOfNode(page, target);
    assert(pt, '无法换算节点屏幕坐标');
    await page.mouse.move(pt.x, pt.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(pt.x + 80, pt.y + 50, { steps: 14 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    const after = await waitNextEngineStop(page, before.engineStop, 45_000);
    assert(after.engineStop !== before.engineStop, '拖拽后引擎未重新停止（未重热）');
    const start = new Map(before.positions.map((n) => [n.id, n])).get(target.id);
    const end = new Map(after.positions.map((n) => [n.id, n])).get(target.id);
    assert(start && end, '拖拽节点不在快照中');
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    assert(moved > 3, `拖拽位移=${moved.toFixed(2)}px`);
    return `节点位移 ${moved.toFixed(1)}px（图坐标），engineStop 更新 ${Math.round(before.engineStop)}→${Math.round(after.engineStop)}ms`;
  });

  // ---------- 7. ?fixture= 压测模式 ----------
  await check('回归：?fixture=graph-small 压测模式加载 500 节点', async () => {
    await page.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/压测数据模式：graph-small（500 节点）/).waitFor({ timeout: 90_000 });
    const snap = await poll(async () => {
      const s = await snapshot(page);
      return s.positions.length === 500 && typeof s.engineStop === 'number' ? s : undefined;
    }, 120_000);
    assert(snap, '未等到 500 节点坐标快照');
    await page.screenshot({ path: 'artifacts/phase0-qa-after-fixture-small.png' });
    return `badge 显示 500 节点，坐标快照 ${snap.positions.length} 条，engineStop=${Math.round(snap.engineStop)}ms`;
  });

  // ---------- 8. 加载骨架 / 空态 ----------
  await check('回归：加载骨架（延迟响应时显示“加载中”）', async () => {
    const p = await context.newPage();
    await p.route('**/api/graph', async (route) => {
      await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p.locator('[role="status"][aria-label="加载中"]').waitFor({ state: 'visible', timeout: 10_000 });
    await p.waitForTimeout(3_000);
    await p.close();
    return '延迟 2.5s 期间出现 role=status aria-label=加载中 骨架';
  });

  await check('回归：空态（nodes=[] 时显示“图谱还没有灯。”与去导入）', async () => {
    const p = await context.newPage();
    await p.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
    await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p.getByText('图谱还没有灯。').waitFor({ timeout: 30_000 });
    const link = p.getByRole('link', { name: '去导入' });
    assert(await link.isVisible(), '去导入 链接不可见');
    assert((await link.getAttribute('href')) === '/import', 'href 不是 /import');
    await p.screenshot({ path: 'artifacts/phase0-qa-after-empty.png' });
    await p.close();
    return '空态文案 + 去导入(/import) 正常';
  });

  await check('回归：主页面无 console/page error', async () => {
    assert(pageErrors.length === 0, `pageerror: ${pageErrors.slice(0, 2).join(' | ')}`);
    assert(consoleErrors.length === 0, `console.error: ${consoleErrors.slice(0, 3).join(' | ')}`);
    return `pageerror=0 console.error=0（累计数据请求 ${dataRequests.length} 次）`;
  });
} catch (error) {
  record('脚本级异常', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
} finally {
  await browser.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const summary = {
    baseURL,
    capturedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  writeFileSync('artifacts/phase0-qa-after-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
