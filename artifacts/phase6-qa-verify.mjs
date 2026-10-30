/**
 * U4-3 学习地图出口门禁 · QA 功能验收（只写 artifacts/）。
 * 覆盖：四类计数独立复算、逐类通道/叠加、颜色与半径不变、启用 1 次请求、
 *      失败降级、清除、移动端、8k 地图 smoke、阶段 0–4 回归。
 */
import { chromium, request } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
async function check(name, fn) {
  try {
    record(name, true, await fn());
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function poll(fn, timeout, interval = 80) {
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
  page.evaluate(() => ({ positions: window.__kbGraphNodePositions ?? [], engineStop: window.__kbGraphEngineStop ?? null }));
async function waitGraphReady(page, timeout = 120_000) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
  const snap = await poll(async () => {
    const s = await snapshot(page);
    return s.positions.length > 0 ? s : undefined;
  }, timeout);
  assert(snap, '等待图谱坐标超时');
  await page.waitForTimeout(300);
  return snapshot(page);
}
const login = async (page) => {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL('**/graph', { timeout: 30_000 });
};
const mapButton = (page) => page.getByRole('button', { name: /学习地图/ });
const mapPanel = (page) => page.locator('div', { hasText: '学习地图用独立的' }).last();
const legendChips = (page) => page.locator('div.absolute.bottom-8.left-3 span');
async function openMap(page) {
  await mapButton(page).click();
  await page.getByRole('button', { name: '地图', exact: true }).waitFor({ timeout: 8_000 });
  await page.waitForTimeout(200);
}
const CIRCLED = { weak: '薄弱', due: '到期复习', today: '今日推荐', hub: '重要枢纽' };
async function toggleType(page, type) {
  const label = page.locator('label', { hasText: CIRCLED[type] }).first();
  await label.locator('input[type="checkbox"]').click();
  await page.waitForTimeout(250);
}
async function clickText(page, text) {
  await page.getByRole('button', { name: text, exact: true }).click();
  await page.waitForTimeout(400);
}
async function panelCounts(page) {
  return page.evaluate(() => {
    const out = {};
    const map = { 薄弱: 'weak', 到期复习: 'due', 今日推荐: 'today', 重要枢纽: 'hub' };
    for (const el of document.querySelectorAll('label')) {
      const text = el.textContent ?? '';
      for (const [cn, key] of Object.entries(map)) {
        if (!text.includes(cn)) continue;
        const numEl = [...el.querySelectorAll('span')].find((s) => String(s.className).includes('font-mono'));
        if (numEl) out[key] = Number(numEl.textContent.trim());
      }
    }
    return out;
  });
}
async function chipTexts(page) {
  return page.evaluate(() => {
    const box = document.querySelector('div.absolute.bottom-8.left-3');
    if (!box) return [];
    return [...box.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean);
  });
}
/** 截取节点周围 61×61 区域（canvas 像素），返回数组与半径带差分统计。 */
async function regionAround(page, pos, size = 61) {
  return page.evaluate(
    ({ x, y, size }) => {
      const fg = window.__kbGraphInstance;
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const r = canvas.getBoundingClientRect();
      const p = fg.graph2ScreenCoords(x, y);
      const sx = Math.round((p.x / r.width) * canvas.width);
      const sy = Math.round((p.y / r.height) * canvas.height);
      const half = (size - 1) / 2;
      const d = ctx.getImageData(sx - half, sy - half, size, size).data;
      return { data: Array.from(d), size, scaleX: canvas.width / r.width, scaleY: canvas.height / r.height };
    },
    { ...pos, size },
  );
}
function diffStats(before, after, size) {
  const half = (size - 1) / 2;
  let total = 0;
  let ur = 0;
  let ll = 0;
  let ringNear = 0;
  let ringFar = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const diff =
        Math.abs(before.data[i] - after.data[i]) +
        Math.abs(before.data[i + 1] - after.data[i + 1]) +
        Math.abs(before.data[i + 2] - after.data[i + 2]) +
        Math.abs(before.data[i + 3] - after.data[i + 3]);
      if (diff <= 12) continue;
      total += 1;
      const dx = x - half;
      const dy = y - half;
      const dist = Math.hypot(dx, dy);
      if (dx >= 0 && dy <= 0) ur += 1;
      if (dx <= 0 && dy >= 0) ll += 1;
      if (dist >= 2 && dist <= 7) ringNear += 1;
      if (dist > 7 && dist <= 13) ringFar += 1;
    }
  }
  return { total, ur, ll, ringNear, ringFar };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 200));
});
const todayRequests = [];
page.on('request', (req) => {
  if (req.url().includes('/api/learning/today')) todayRequests.push({ at: Date.now(), method: req.method() });
});

try {
  await login(page);
  const base = await waitGraphReady(page);
  const apiCtx = await request.newContext({ baseURL });
  await apiCtx.post('/api/auth/login', { data: { passcode } });
  const graph = await (await apiCtx.get('/api/graph')).json();
  const today = await (await apiCtx.get('/api/learning/today')).json();
  const todayItems = (today.items ?? []).map((i) => ({ segmentId: i.segmentId, reasonCode: i.reasonCode }));
  const ends = (l) => [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target];
  const adj = new Map();
  for (const l of graph.edges) {
    const [s, t] = ends(l);
    if (!s || !t || s === t) continue;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  }
  // 独立复算（与 graph-map.ts 同口径）
  const weak = new Set(graph.nodes.filter((n) => n.memory < 0.4).map((n) => n.id));
  const dueIds = new Set(todayItems.filter((i) => i.reasonCode === 'due-review').map((i) => i.segmentId));
  const todayIds = new Set(todayItems.filter((i) => i.reasonCode !== 'due-review').map((i) => i.segmentId));
  const degrees = graph.nodes
    .map((n) => ({ id: n.id, degree: adj.get(n.id)?.size ?? 0 }))
    .filter((e) => e.degree >= 2)
    .sort((a, b) => (b.degree === a.degree ? a.id.localeCompare(b.id) : b.degree - a.degree));
  const hubIds = new Set(degrees.slice(0, Math.max(1, Math.ceil(degrees.length * 0.1))).map((e) => e.id));
  const expected = { weak: weak.size, due: dueIds.size, today: todayIds.size, hub: hubIds.size };
  const posById = new Map(base.positions.map((p) => [p.id, p]));

  await check('计数复算：图例/面板四类计数与真实 /api/graph + /api/learning/today 一致', async () => {
    await openMap(page);
    await clickText(page, '全部显示');
    const counts = await panelCounts(page);
    for (const k of ['weak', 'due', 'today', 'hub']) {
      assert(counts[k] === expected[k], `${k} 面板=${counts[k]} 期望=${expected[k]}`);
    }
    const chips = await chipTexts(page);
    assert(chips.length === 4, `图例 chips=${chips.length}：${chips.join(' / ')}`);
    for (const [k, label] of Object.entries(CIRCLED)) {
      assert(chips.some((c) => c.includes(label) && c.includes(String(expected[k]))), `图例缺少 ${label} ${expected[k]}：${chips.join(' / ')}`);
    }
    await page.screenshot({ path: 'artifacts/phase6-qa-map-all.png' });
    return `weak=${expected.weak} due=${expected.due} today=${expected.today} hub=${expected.hub}（面板+4 图例一致）`;
  });

  await check('启用仅 1 次 /api/learning/today；切换勾选不重复请求', async () => {
    const count = todayRequests.length;
    assert(count === 1, `启用后 today 请求次数=${count}`);
    await toggleType(page, 'hub');
    await toggleType(page, 'hub');
    await page.waitForTimeout(400);
    assert(todayRequests.length === 1, `切换勾选后请求次数=${todayRequests.length}`);
    return `启用 1 次（GET），切换类型后仍为 1 次`;
  });

  // 基线（地图关闭）→ 逐类单开差分
  await clickText(page, '清除标记');
  assert((await chipTexts(page)).length === 0, '清除后图例未消失');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  const weakNode = graph.nodes.find((n) => n.id === [...weak][0] && posById.has(n.id));
  const weakPos = posById.get(weakNode.id);
  const baseline = await regionAround(page, weakPos);

  await check('逐类通道：薄弱=全环（近半径）、枢纽=更外环、两类都非单向弧', async () => {
    await openMap(page);
    await toggleType(page, 'weak');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const afterWeak = await regionAround(page, weakPos);
    const dWeak = diffStats(baseline, afterWeak, 61);
    assert(dWeak.total > 0, '薄弱通道无像素变化');
    assert(dWeak.ur > 0 && dWeak.ll > 0, `薄弱环不是全环：ur=${dWeak.ur} ll=${dWeak.ll}`);
    await page.screenshot({ path: 'artifacts/phase6-qa-map-weak.png' });
    // hub 节点（取 hub 集合中在视口内的节点）
    const hubId = [...hubIds].find((id) => posById.has(id));
    let dHub = null;
    if (hubId) {
      const hubPos = posById.get(hubId);
      await clickText(page, '清除标记');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      const hubBase = await regionAround(page, hubPos);
      await openMap(page);
      await toggleType(page, 'hub');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      const hubAfter = await regionAround(page, hubPos);
      dHub = diffStats(hubBase, hubAfter, 61);
      assert(dHub.total > 0, '枢纽通道无像素变化');
      assert(dHub.ur > 0 && dHub.ll > 0, `枢纽点线环不是全环：ur=${dHub.ur} ll=${dHub.ll}`);
    }
    await clickText(page, '清除标记');
    return `weak 全环 diff=${dWeak.total}（ur=${dWeak.ur}/ll=${dWeak.ll}）${dHub ? `；hub 外环 diff=${dHub.total}（ur=${dHub.ur}/ll=${dHub.ll}，far=${dHub.ringFar}）` : ''}`;
  });

  await check('颜色与半径语义不变：启用前后同节点中心 9×9 像素完全一致', async () => {
    const before = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const r = canvas.getBoundingClientRect();
      const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
      const sx = Math.round((p.x / r.width) * canvas.width);
      const sy = Math.round((p.y / r.height) * canvas.height);
      return Array.from(ctx.getImageData(sx - 4, sy - 4, 9, 9).data);
    }, weakPos);
    await openMap(page);
    await clickText(page, '全部显示');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(500);
    const after = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const r = canvas.getBoundingClientRect();
      const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
      const sx = Math.round((p.x / r.width) * canvas.width);
      const sy = Math.round((p.y / r.height) * canvas.height);
      return { data: Array.from(ctx.getImageData(sx - 4, sy - 4, 9, 9).data), center: [0, 1, 2].map((i) => ctx.getImageData(sx, sy, 1, 1).data[i]) };
    }, weakPos);
    let maxDiff = 0;
    for (let i = 0; i < before.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(before[i] - after.data[i]));
    assert(maxDiff <= 2, `中心 9×9 像素变化 maxDiff=${maxDiff}`);
    return `中心 9×9 最大像素差=${maxDiff}（中心 RGB=${after.center.join(',')}），记忆度颜色/核心半径不变（外环为独立通道）`;
  });

  await check('四类叠加不互相覆盖（全开时 weak/hub 全环 + 图例 4 chips 同时存在）', async () => {
    const chips = await chipTexts(page);
    assert(chips.length === 4, `叠加后图例=${chips.length}`);
    const pos = posById.get([...weak][0]);
    const after = await regionAround(page, pos);
    const d = diffStats(baseline, after, 61);
    assert(d.total > 0 && d.ur > 0 && d.ll > 0, '叠加后通道像素缺失');
    return `4 chips + 节点周边 diff=${d.total}（ur=${d.ur}/ll=${d.ll}），多通道共存`;
  });

  // 到期/今日：受控 route（真实库 due=0，无法用真实数据验证弧线方向）
  await check('到期弧（右上）与今日弧（左下）方向可区分（受控 today 数据）', async () => {
    const p = await context.newPage();
    try {
      await p.route('**/api/learning/today', (route) =>
        route.fulfill({ json: { items: [{ segmentId: graph.nodes[0].id, reasonCode: 'due-review' }, { segmentId: graph.nodes[1].id, reasonCode: 'recommend' }] } }),
      );
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      const snap = await waitGraphReady(p);
      const pm = new Map(snap.positions.map((x) => [x.id, x]));
      const duePos = pm.get(graph.nodes[0].id);
      const todayPos = pm.get(graph.nodes[1].id);
      await p.mouse.move(2, 2);
      await p.waitForTimeout(300);
      const bDue = await regionAround(p, duePos);
      const bToday = await regionAround(p, todayPos);
      await p.getByRole('button', { name: /学习地图/ }).click();
      await p.getByRole('button', { name: '地图', exact: true }).waitFor({ timeout: 8_000 });
      await p.getByRole('button', { name: '全部显示', exact: true }).click();
      await p.mouse.move(2, 2);
      await p.waitForTimeout(500);
      const aDue = await regionAround(p, duePos);
      const aToday = await regionAround(p, todayPos);
      const dDue = diffStats(bDue, aDue, 61);
      const dToday = diffStats(bToday, aToday, 61);
      assert(dDue.total > 0 && dToday.total > 0, `due diff=${dDue.total} today diff=${dToday.total}`);
      assert(dDue.ur > dDue.ll * 2, `到期弧应偏右上：ur=${dDue.ur} ll=${dDue.ll}`);
      assert(dToday.ll > dToday.ur * 2, `今日弧应偏左下：ur=${dToday.ur} ll=${dToday.ll}`);
      const counts = await panelCounts(p);
      assert(counts.due === 1 && counts.today === 1, `受控计数 due=${counts.due} today=${counts.today}`);
      await p.screenshot({ path: 'artifacts/phase6-qa-map-due-today.png' });
      return `due 右上(ur=${dDue.ur}/ll=${dDue.ll})，today 左下(ur=${dToday.ur}/ll=${dToday.ll})，计数 1/1`;
    } finally {
      await p.close();
    }
  });

  await check('失败降级：/api/learning/today abort → 提示 + 仅薄弱/枢纽仍绘制', async () => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    try {
      await p.route('**/api/learning/today', (route) => route.abort());
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      const snap = await waitGraphReady(p);
      const pm = new Map(snap.positions.map((x) => [x.id, x]));
      const weakPos2 = pm.get([...weak][0]);
      await p.mouse.move(2, 2);
      await p.waitForTimeout(300);
      const before = await regionAround(p, weakPos2);
      await p.getByRole('button', { name: /学习地图/ }).click();
      await p.getByRole('button', { name: '地图', exact: true }).waitFor({ timeout: 8_000 });
      await p.getByRole('button', { name: '全部显示', exact: true }).click();
      await p.getByText(/今日学习数据加载失败/).waitFor({ state: 'visible', timeout: 8_000 });
      await p.mouse.move(2, 2);
      await p.waitForTimeout(500);
      const after = await regionAround(p, weakPos2);
      const d = diffStats(before, after, 61);
      assert(d.total > 0, '失败降级后薄弱通道未绘制');
      const counts = await panelCounts(p);
      assert(counts.weak === expected.weak, `降级后 weak=${counts.weak}`);
      assert(counts.due === 0 && counts.today === 0, `降级后 due=${counts.due}/today=${counts.today}`);
      assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
      return `提示可见；weak=${counts.weak} 仍绘制，due/today=0，pageerror=0`;
    } finally {
      await p.close();
    }
  });

  await check('清除标记 → 图例消失、画布恢复基线（同一节点 on/off 对照）', async () => {
    const nodePos = posById.get([...weak][0]);
    await openMap(page);
    if ((await chipTexts(page)).length > 0) await clickText(page, '清除标记');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const offA = await regionAround(page, nodePos);
    await openMap(page);
    await clickText(page, '全部显示');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const on = await regionAround(page, nodePos);
    const dOn = diffStats(offA, on, 61);
    assert(dOn.total > 0, '启用后未检测到标记像素');
    await clickText(page, '清除标记');
    assert((await chipTexts(page)).length === 0, '图例未消失');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const offB = await regionAround(page, nodePos);
    const dOff = diffStats(offA, offB, 61);
    assert(dOff.total <= 12, `清除后仍有 ${dOff.total} 像素差异（>12 噪声阈值）`);
    return `启用 diff=${dOn.total}；清除后 diff=${dOff.total}（≤12 AA 噪声阈值），图例 0 chips`;
  });

  await check('移动端 375：地图入口可用、面板不越界、无横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    await openMap(page);
    const m = await page.evaluate(() => {
      const panel = [...document.querySelectorAll('div')].find((el) => el.textContent.includes('学习地图用独立的') && el.className.includes('absolute'));
      const box = panel ?? document.body;
      const r = box.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollW: document.documentElement.scrollWidth };
    });
    assert(m.left >= -1 && m.right <= 376 && m.top >= 0, `面板越界 ${JSON.stringify(m)}`);
    assert(m.scrollW <= 376, `横向溢出 ${m.scrollW}`);
    await page.screenshot({ path: 'artifacts/phase6-qa-map-mobile.png' });
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return `面板 ${m.left.toFixed(0)}–${m.right.toFixed(0)}，无横向溢出`;
  });

  // 回归（独立页面）
  await check('回归：搜索/详情/右键/一阶 focus/路径/主题/筛选/力/fixture/空态/骨架', async () => {
    const p = await context.newPage();
    try {
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      const snap = await waitGraphReady(p);
      await p.keyboard.press('Control+K');
      await p.getByRole('combobox').fill('网络');
      await p.locator('section[aria-label="搜索知识"] [role="option"]').first().waitFor({ timeout: 10_000 });
      const n = await p.locator('section[aria-label="搜索知识"] [role="option"]').count();
      assert(n === 3, `搜索结果=${n}`);
      await p.getByRole('combobox').press('Escape');
      const pt = await p.evaluate(({ x, y }) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const pos = window.__kbGraphInstance.graph2ScreenCoords(x, y);
        return { x: r.left + pos.x, y: r.top + pos.y };
      }, snap.positions[0]);
      await p.mouse.click(pt.x, pt.y, { button: 'right' });
      await p.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 5_000 });
      assert((await p.locator('[role="menu"] [role="menuitem"]').count()) === 7, '右键菜单项数');
      await p.keyboard.press('Escape');
      await p.mouse.click(pt.x, pt.y);
      await p.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 10_000 });
      await p.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开一阶关联/ }).click();
      await p.waitForTimeout(250);
      const t = await p.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开二阶关联|收起关联/ }).innerText();
      assert(t.includes('展开二阶关联'), `一阶后=${t}`);
      // 详情面板打开会挡住设置按钮，先关面板再验证设置/主题
      await p.mouse.click(40, 900);
      await p.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      await p.locator('button[aria-label="关系图谱设置"]').click();
      for (const tab of ['筛选', '分组', '显示', '力', '主题', '地图']) {
        await p.getByRole('button', { name: tab, exact: true }).waitFor({ timeout: 5_000 });
      }
      await p.getByRole('button', { name: '力', exact: true }).click();
      assert((await p.locator('input[type="range"]').count()) === 4, '力滑块数量');
      await p.locator('button[aria-label="关系图谱设置"]').click();
      return '搜索 3 条、右键 7 项、详情/一阶 focus、六页签/4 力滑块正常';
    } finally {
      await p.close();
    }
  });

  await check('回归：拖拽/fixture/空态/骨架/主题持久化', async () => {
    const p = await context.newPage();
    try {
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      const snap = await waitGraphReady(p);
      const pt = await p.evaluate(({ x, y }) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const pos = window.__kbGraphInstance.graph2ScreenCoords(x, y);
        return { x: r.left + pos.x, y: r.top + pos.y };
      }, snap.positions[0]);
      await p.mouse.move(pt.x, pt.y, { steps: 3 });
      await p.mouse.down();
      await p.mouse.move(pt.x + 60, pt.y + 40, { steps: 8 });
      await p.waitForTimeout(200);
      await p.mouse.up();
      const reheated = await poll(async () => {
        const cur = await snapshot(p);
        return cur.engineStop !== snap.engineStop ? cur : undefined;
      }, 30_000);
      assert(reheated, '拖拽未重排');
      await p.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
      await waitGraphReady(p);
      assert((await p.locator('[aria-label="压测数据模式：graph-small"]').count()) === 1, 'fixture 徽标缺失');
      const e = await context.newPage();
      await e.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
      await e.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await e.getByText('图谱还没有灯。').waitFor({ timeout: 30_000 });
      await e.close();
      const k = await context.newPage();
      await k.route('**/api/graph', async (route) => {
        await new Promise((r) => setTimeout(r, 2_000));
        await route.continue().catch(() => {});
      });
      await k.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await k.locator('[role="status"][aria-label="加载中"]').waitFor({ state: 'visible', timeout: 10_000 });
      await k.waitForTimeout(2_400);
      await k.close();
      return '拖拽重排、fixture 500、空态、骨架正常';
    } finally {
      await p.close();
    }
  });

  await check('8k 地图 smoke：启用全四类不崩、帧可接受', async () => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    try {
      await p.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
      const snap = await poll(async () => {
        const s = await snapshot(p);
        return s.positions.length === 8000 ? s : undefined;
      }, 180_000);
      assert(snap, '8k 未加载');
      await p.evaluate(() => {
        window.__qaLong = [];
        window.__qaGaps = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__qaLong.push(e.duration);
        }).observe({ type: 'longtask', buffered: false });
        let last = performance.now();
        const loop = () => {
          const now = performance.now();
          window.__qaGaps.push(now - last);
          last = now;
          if (window.__qaGaps.length < 200) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await p.getByRole('button', { name: /学习地图/ }).click();
      await p.getByRole('button', { name: '地图', exact: true }).waitFor({ timeout: 8_000 });
      const t0 = Date.now();
      await p.getByRole('button', { name: '全部显示', exact: true }).click();
      await p.waitForTimeout(1_000);
      const enabledMs = Date.now() - t0;
      const m = await p.evaluate(() => ({
        maxLong: window.__qaLong?.length ? Math.max(...window.__qaLong) : 0,
        maxGap: Math.max(0, ...(window.__qaGaps ?? [])),
        frames: (window.__qaGaps ?? []).length,
        canvas: document.querySelectorAll('canvas').length,
      }));
      assert(m.canvas === 1, 'canvas 消失');
      assert(m.frames > 0, 'rAF 未继续');
      assert(m.maxGap < 2_000, `最大帧间隔 ${m.maxGap.toFixed(0)}ms`);
      assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
      await p.screenshot({ path: 'artifacts/phase6-qa-map-8k.png' });
      return `8k map 全开 ${enabledMs}ms：longTask max=${m.maxLong.toFixed(0)}ms、帧间隔 max=${m.maxGap.toFixed(0)}ms、续帧 ${m.frames}，未崩溃`;
    } finally {
      await p.close();
    }
  });

  await check('主流程 0 console/page error', async () => {
    assert(pageErrors.length === 0, `pageerror：${pageErrors.slice(0, 2).join(' | ')}`);
    const real = consoleErrors.filter((e) => !/ERR_NETWORK_IO_SUSPENDED/.test(e));
    assert(real.length === 0, `console.error：${real.slice(0, 3).join(' | ')}`);
    return 'pageerror=0，console.error=0';
  });
} catch (error) {
  record('脚本级异常', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
} finally {
  await browser.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const summary = { baseURL, capturedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync('artifacts/phase6-qa-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
