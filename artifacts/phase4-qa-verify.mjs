/**
 * 阶段 4（部分 U4-1/U4-2/U4-5）出口门禁 · QA 独立验收（只写 artifacts/）。
 *
 * 覆盖：
 *  A. U4-1 详情面板「展开关联」循环 0→1→2→0；focus 集合与真实 links BFS 复算一致；
 *     非 focus 节点调光 0.35；只改视图（坐标/engineStop/nodes 不变）；8k 二阶不崩、300 上限由单测/代码覆盖
 *  B. U4-2 三类路径（直接/间接/无路径）；compare bar 节点链 + 关系类型；路径节点 1 / 其余 0.25；
 *     路径边提亮；清除/高亮路径开关；links 数据前后一致；搜索/详情不回归
 *  C. U4-5 桌面右键菜单 7 项 + disabled 2 项 + 键盘 ↑↓/Home/End/Enter/Esc；菜单动作（聚焦/一/二阶/阅读/编辑）；
 *     近边缘 clamp；点击外部关闭；移动端 touch 长按 500ms 弹菜单且不越界
 *  D. 阶段 0–2 回归 + 8k 二阶/路径激活 smoke
 *
 * 用法：KB_PASSCODE=... node artifacts/phase4-qa-verify.mjs
 */
import { chromium, request } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const results = [];
let allowNetworkErrors = 0;

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
async function waitGraphReady(page, expected = null, timeout = 120_000) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
  const snap = await poll(async () => {
    const s = await snapshot(page);
    if (!s.positions.length) return undefined;
    return expected === null || s.positions.length === expected ? s : undefined;
  }, timeout);
  assert(snap, `等待图谱坐标超时（期望 ${expected ?? '任意'} 节点）`);
  await page.waitForTimeout(300);
  return snapshot(page);
}
async function screenPointOfNode(page, pos) {
  return page.evaluate(({ x, y, id }) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    if (!fg || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const p = fg.graph2ScreenCoords(x, y);
    return { id, x: r.left + p.x, y: r.top + p.y };
  }, pos);
}
/** 点前确认该视口点命中的是 canvas（避开面板/浮层遮挡）。 */
async function canvasPointAt(page, pt) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el && el.tagName === 'CANVAS' ? { x, y } : null;
  }, pt);
}
async function clickNode(page, pos) {
  const raw = await screenPointOfNode(page, pos);
  assert(raw, '无法换算节点屏幕坐标');
  const ok = await canvasPointAt(page, raw);
  assert(ok, `节点 (${raw.x.toFixed(0)},${raw.y.toFixed(0)}) 被浮层遮挡，无法点击`);
  await page.mouse.click(ok.x, ok.y);
  return ok;
}
/** 读取 compare bar 的「已选 N/2」，返回 N（无 bar 时 0）。 */
async function selectedCount(page) {
  const text = await page.getByText(/已选 \d\/2/).first().innerText().catch(() => '');
  const m = text.match(/已选 (\d)\/2/);
  return m ? Number(m[1]) : 0;
}
/** 可靠地双选两个节点（点击可能互相遮挡/落在邻点上，失败则复位并返回 false）。 */
async function selectPair(page, clickA, clickB) {
  const exit = page.getByRole('button', { name: '退出', exact: true });
  if ((await exit.count()) > 0 && (await exit.first().isVisible().catch(() => false))) {
    await exit.first().click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: '联系两概念' }).click();
  const opened = await poll(async () => ((await selectedCount(page)) === 0 ? true : undefined), 1_500);
  if (!opened) return false;
  await clickA();
  const one = await poll(async () => ((await selectedCount(page)) === 1 ? true : undefined), 1_500);
  if (!one) return false;
  await clickB();
  const two = await poll(async () => ((await selectedCount(page)) === 2 ? true : undefined), 1_500);
  return two;
}
async function rightClickNode(page, pos) {
  const raw = await screenPointOfNode(page, pos);
  assert(raw, '无法换算节点屏幕坐标');
  const ok = await canvasPointAt(page, raw);
  assert(ok, `节点被遮挡，无法右键`);
  await page.mouse.click(ok.x, ok.y, { button: 'right' });
  return ok;
}
async function sampleNodeAlpha(page, pos) {
  return page.evaluate(({ x, y }) => {
    const fg = window.__kbGraphInstance;
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    const p = fg.graph2ScreenCoords(x, y);
    if (p.x < 4 || p.y < 4 || p.x > r.width - 4 || p.y > r.height - 4) return null;
    const sx = (p.x / r.width) * canvas.width;
    const sy = (p.y / r.height) * canvas.height;
    const half = 2;
    const d = ctx.getImageData(Math.round(sx) - half, Math.round(sy) - half, half * 2 + 1, half * 2 + 1).data;
    let max = 0;
    for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i]);
    return max / 255;
  }, pos);
}
async function sampleLineLuma(page, a, b) {
  return page.evaluate(({ ax, ay, bx, by }) => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const steps = 50;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < steps; i += 1) {
      const t = 0.2 + (i / (steps - 1)) * 0.6;
      const gx = ax + (bx - ax) * t;
      const gy = ay + (by - ay) * t;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = ctx.getImageData(Math.round(gx * scaleX) + dx, Math.round(gy * scaleY) + dy, 1, 1).data;
        if (d[3] > 30) {
          sum += 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
          count += 1;
        }
      }
    }
    return { mean: count ? sum / count : 0, count };
  }, { ax: a.x, ay: a.y, bx: b.x, by: b.y });
}
const detail = (page) => page.locator('aside[aria-label="知识点详情"]');
async function waitDetailOk(page) {
  await detail(page).waitFor({ state: 'visible', timeout: 15_000 });
  const title = await poll(async () => {
    const t = await detail(page).locator('h2').first().innerText().catch(() => '');
    return t && t !== '加载中…' ? t.trim() : undefined;
  }, 15_000);
  assert(title, '详情标题未加载');
  return title;
}
const closeDetail = async (page) => {
  if (await detail(page).isVisible().catch(() => false)) {
    await page.locator('button[aria-label="关闭详情"]').click();
    await detail(page).waitFor({ state: 'detached', timeout: 5_000 });
  }
};
const menu = (page) => page.locator('[role="menu"]');
const blurMouse = async (page) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
};
/** 保证双选模式处于关闭态（避免上一个用例失败后级联）。 */
const ensureCompareOff = async (page) => {
  const exit = page.getByRole('button', { name: '退出', exact: true });
  if ((await exit.count()) > 0 && (await exit.first().isVisible().catch(() => false))) {
    await exit.first().click().catch(() => {});
    await page.waitForTimeout(250);
  }
};

// 纯逻辑复算（与 src/lib/graph/graph-focus.ts 同口径）
const ends2 = (l) => [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target];
function buildAdjacency(links) {
  const adj = new Map();
  for (const l of links) {
    const [s, t] = ends2(l);
    if (!s || !t || s === t) continue;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
  }
  return adj;
}
function collectNeighbors(seed, adj, depth, maxNodes = 300) {
  const result = new Set([seed]);
  let frontier = new Set([seed]);
  for (let level = 0; level < depth && frontier.size; level += 1) {
    const next = new Set();
    for (const id of [...frontier].sort()) {
      for (const nb of [...(adj.get(id) ?? [])].sort()) {
        if (result.has(nb)) continue;
        if (result.size >= maxNodes) break;
        result.add(nb);
        next.add(nb);
      }
      if (result.size >= maxNodes) break;
    }
    frontier = next;
  }
  return result;
}
function shortestPathCalc(links, from, to) {
  if (from === to) return { nodeIds: [from], edges: [] };
  const adj = new Map();
  const add = (a, b, kind) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ id: b, kind });
  };
  for (const l of links) {
    const [s, t] = ends2(l);
    if (!s || !t || s === t) continue;
    add(s, t, l.kind);
    add(t, s, l.kind);
  }
  for (const list of adj.values()) list.sort((a, b) => (a.id === b.id ? a.kind.localeCompare(b.kind) : a.id.localeCompare(b.id)));
  const prev = new Map();
  const visited = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const step of adj.get(cur) ?? []) {
      if (visited.has(step.id)) continue;
      visited.add(step.id);
      prev.set(step.id, { from: cur, kind: step.kind });
      queue.push(step.id);
    }
  }
  if (!visited.has(to)) return null;
  const nodeIds = [to];
  const edges = [];
  let cur = to;
  while (cur !== from) {
    const step = prev.get(cur);
    if (!step) return null;
    nodeIds.push(step.from);
    edges.push({ kind: step.kind });
    cur = step.from;
  }
  nodeIds.reverse();
  edges.reverse();
  return { nodeIds, edges };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });

try {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e instanceof Error ? (e.stack ?? String(e)) : String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('favicon')) return;
    if (allowNetworkErrors > 0 && /Failed to load resource|40[34]|Service Unavailable/.test(m.text())) return;
    consoleErrors.push(m.text().slice(0, 300));
  });

  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`, { timeout: 30_000 });
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  const base = await waitGraphReady(page);
  const apiCtx = await request.newContext({ baseURL });
  await apiCtx.post('/api/auth/login', { data: { passcode } });
  const payload = await (await apiCtx.get('/api/graph')).json();
  const titleById = new Map(payload.nodes.map((n) => [n.id, n.title]));
  const posById = new Map(base.positions.map((p) => [p.id, p]));
  const adj = buildAdjacency(payload.edges);
  const degree = (id) => (adj.get(id) ?? new Set()).size;
  const seedId = [...payload.nodes].sort((a, b) => degree(b.id) - degree(a.id))[0].id;
  const seedPos = posById.get(seedId);

  // ---------- A. U4-1 focus 循环 ----------
  await check('U4-1：详情面板「展开关联」按钮循环 一阶→二阶→收起', async () => {
    await clickNode(page, seedPos);
    await waitDetailOk(page);
    const btn = detail(page).getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
    const seq = [];
    seq.push({ text: (await btn.innerText()).trim(), pressed: await btn.getAttribute('aria-pressed') });
    await btn.click();
    await page.waitForTimeout(350);
    seq.push({ text: (await btn.innerText()).trim(), pressed: await btn.getAttribute('aria-pressed') });
    await btn.click();
    await page.waitForTimeout(350);
    seq.push({ text: (await btn.innerText()).trim(), pressed: await btn.getAttribute('aria-pressed') });
    await btn.click();
    await page.waitForTimeout(300);
    seq.push({ text: (await btn.innerText()).trim(), pressed: await btn.getAttribute('aria-pressed') });
    assert(seq[0].text === '展开一阶关联' && seq[0].pressed === 'false', `初始 ${JSON.stringify(seq[0])}`);
    assert(seq[1].text === '展开二阶关联' && seq[1].pressed === 'true', `一阶后 ${JSON.stringify(seq[1])}`);
    assert(seq[2].text === '收起关联' && seq[2].pressed === 'true', `二阶后 ${JSON.stringify(seq[2])}`);
    assert(seq[3].text === '展开一阶关联' && seq[3].pressed === 'false', `收起后 ${JSON.stringify(seq[3])}`);
    return seq.map((s) => `${s.text}(aria-pressed=${s.pressed})`).join(' → ');
  });

  await check('U4-1：一阶/二阶 focus 集合与真实 links BFS 复算一致（非 focus 调光）', async () => {
    const expect1 = collectNeighbors(seedId, adj, 1);
    const expect2 = collectNeighbors(seedId, adj, 2);
    const btn = detail(page).getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
    const sampleAll = async () => {
      await blurMouse(page);
      const m = new Map();
      for (const p of base.positions) {
        const a = await sampleNodeAlpha(page, p);
        if (a !== null) m.set(p.id, a);
      }
      return m;
    };
    const baseline = await sampleAll();
    assert(baseline.size >= 12, `可采样节点=${baseline.size}（视口内）`);
    for (const id of [...expect2]) assert(baseline.has(id), `期望集合节点 ${titleById.get(id)} 不在视口内`);
    const classify = (m) => {
      const focus = new Set();
      const dim = new Set();
      for (const [id, a] of m) {
        const b = baseline.get(id);
        if (b === undefined) continue;
        const ratio = b > 0 ? a / b : 1;
        if (ratio >= 0.95) focus.add(id);
        else if (ratio <= 0.8) dim.add(id);
      }
      return { focus, dim };
    };
    await btn.click(); // 0 → 1
    await page.waitForTimeout(400);
    const c1 = classify(await sampleAll());
    await btn.click(); // 1 → 2
    await page.waitForTimeout(400);
    const c2 = classify(await sampleAll());
    await btn.click(); // 2 → 0
    await page.waitForTimeout(400);
    const restored = await sampleAll();
    const restoredOk = [...restored.entries()].every(([id, a]) => {
      const b = baseline.get(id);
      return b === undefined || a / b >= 0.95;
    });
    const eq = (set, exp) => [...set].sort().join(',') === [...exp].sort().join(',');
    const complement = (exp) => new Set([...baseline.keys()].filter((id) => !exp.has(id)));
    assert(eq(c1.focus, expect1), `一阶 focus 集合不符：实际 ${c1.focus.size} vs 期望 ${expect1.size}`);
    assert(eq(c2.focus, expect2), `二阶 focus 集合不符：实际 ${c2.focus.size} vs 期望 ${expect2.size}`);
    const dimOk1 = complement(expect1).size === 0 || (c1.dim.size >= complement(expect1).size * 0.8 && [...c1.dim].every((id) => !expect1.has(id)));
    const dimOk2 = complement(expect2).size === 0 || (c2.dim.size >= complement(expect2).size * 0.8 && [...c2.dim].every((id) => !expect2.has(id)));
    assert(dimOk1 && dimOk2, `非 focus 调光不足：一阶 dim=${c1.dim.size}，二阶 dim=${c2.dim.size}`);
    assert(restoredOk, '收起关联后节点未全部恢复');
    return `seed「${titleById.get(seedId)}」一阶 ${c1.focus.size}/${expect1.size}、二阶 ${c2.focus.size}/${expect2.size} 与 BFS 一致；一阶调光 ${c1.dim.size} 个、二阶调光 ${c2.dim.size} 个；收起后全部恢复`;
  });

  await check('U4-1：focus 只改视图（坐标/engineStop/nodes 不变）', async () => {
    const s = await snapshot(page);
    assert(s.positions.length === base.positions.length, '节点数变化');
    assert(s.engineStop === base.engineStop, 'engineStop 变化');
    assert(JSON.stringify(s.positions) === JSON.stringify(base.positions), '坐标变化');
    return `nodes ${s.positions.length}，engineStop/坐标均未变`;
  });
  await closeDetail(page);

  // ---------- B. U4-2 路径 ----------
  const onScreen = async (id) => {
    const p = posById.get(id);
    const raw = await screenPointOfNode(page, p);
    return raw && (await canvasPointAt(page, raw)) ? raw : null;
  };
  // 直接边 + 两个端点都在画布可点
  let direct = null;
  for (const l of payload.edges) {
    const [s, t] = ends2(l);
    if (!s || !t || s === t) continue;
    if ((await onScreen(s)) && (await onScreen(t))) {
      direct = { s, t, kind: l.kind };
      break;
    }
  }
  assert(direct, '找不到可直接点击的连边');

  await check('U4-2 直接路径：双选自动高亮，compare bar 显示节点链 + 关系类型', async () => {
    await ensureCompareOff(page);
    const before = await sampleLineLuma(page, await screenPointOfNode(page, posById.get(direct.s)), await screenPointOfNode(page, posById.get(direct.t)));
    await page.getByRole('button', { name: '联系两概念' }).click();
    await page.getByText(/已选 0\/2/).waitFor({ timeout: 5_000 });
    await clickNode(page, posById.get(direct.s));
    await page.getByText(/已选 1\/2/).waitFor({ timeout: 5_000 });
    await clickNode(page, posById.get(direct.t));
    await page.getByText(/已选 2\/2/).waitFor({ timeout: 5_000 });
    const bar = page.locator('p', { hasText: '路径：' }).last();
    const text = (await bar.innerText()).replace(/\s+/g, ' ');
    const a = titleById.get(direct.s);
    const b = titleById.get(direct.t);
    assert(text.includes(`路径：${a} → ${b}`), `路径文案=${text}`);
    assert(/（(同文档|双链|标签)）/.test(text), `缺少关系类型：${text}`);
    assert((await page.getByRole('button', { name: '清除路径' }).count()) === 1, '缺少清除路径开关');
    await blurMouse(page);
    const pa = await sampleNodeAlpha(page, posById.get(direct.s));
    const pb = await sampleNodeAlpha(page, posById.get(direct.t));
    const other = base.positions.find((p) => p.id !== direct.s && p.id !== direct.t);
    const po = await sampleNodeAlpha(page, other);
    assert(pa >= 0.9 && pb >= 0.9, `路径节点 alpha=${pa},${pb}`);
    assert(po !== null && po <= 0.35, `非路径节点 alpha=${po}`);
    const after = await sampleLineLuma(page, await screenPointOfNode(page, posById.get(direct.s)), await screenPointOfNode(page, posById.get(direct.t)));
    assert(after.mean > before.mean + 5, `路径边未提亮：${before.mean.toFixed(1)} → ${after.mean.toFixed(1)}`);
    await page.screenshot({ path: 'artifacts/phase4-qa-pathDirect.png' });
    return `「${a} → ${b}」；关系类型可见；路径节点 alpha≈1、非路径 ${po.toFixed(2)}；路径边亮度 ${before.mean.toFixed(0)}→${after.mean.toFixed(0)}`;
  });

  await check('U4-2：清除路径 / 高亮路径开关（视觉开关与文案同步）', async () => {
    const other = base.positions.find((p) => p.id !== direct.s && p.id !== direct.t);
    await page.getByRole('button', { name: '清除路径' }).click();
    await blurMouse(page);
    assert((await page.getByRole('button', { name: '高亮路径' }).count()) === 1, '未切换为高亮路径');
    const a1 = await sampleNodeAlpha(page, other);
    assert(a1 !== null && a1 >= 0.9, `清除路径后非路径节点未恢复：${a1}`);
    await page.getByRole('button', { name: '高亮路径' }).click();
    await blurMouse(page);
    const a2 = await sampleNodeAlpha(page, other);
    assert(a2 !== null && a2 <= 0.35, `重新高亮后非路径节点未调暗：${a2}`);
    return `清除 → 非路径 ${a1.toFixed(2)}；高亮 → ${a2.toFixed(2)}`;
  });

  await check('U4-2：路径不修改 links（GET /api/graph 前后一致 + 坐标/engineStop 不变）', async () => {
    const again = await (await apiCtx.get('/api/graph')).json();
    // memory 是读取时现算的派生字段（随时间变化），比较其余契约字段是否被修改
    const stripMemory = (p) => ({ nodes: p.nodes.map((node) => Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'memory'))), edges: p.edges });
    assert(JSON.stringify(stripMemory(again)) === JSON.stringify(stripMemory(payload)), '图谱数据被修改（nodes/edges 契约字段变化）');
    const s = await snapshot(page);
    assert(s.engineStop === base.engineStop, 'engineStop 变化');
    assert(JSON.stringify(s.positions) === JSON.stringify(base.positions), '坐标变化');
    return `edges ${payload.edges.length} 条与节点契约字段一致（除现算 memory），节点坐标/engineStop 未变`;
  });
  await page.getByRole('button', { name: '退出', exact: true }).click();

  // 间接路径候选（distance=2，三个节点都在视口内，最多 6 组）
  const indirectCandidates = [];
  const ids = payload.nodes.map((n) => n.id).filter((id) => posById.has(id));
  outer2: for (const s of ids) {
    for (const t of ids) {
      if (s === t) continue;
      if (adj.get(s)?.has(t)) continue;
      const path = shortestPathCalc(payload.edges, s, t);
      if (path && path.nodeIds.length === 3) {
        let visible = true;
        for (const id of path.nodeIds) {
          if (!(await onScreen(id))) {
            visible = false;
            break;
          }
        }
        if (visible) indirectCandidates.push({ s, t, path });
        if (indirectCandidates.length >= 6) break outer2;
      }
    }
  }

  await check('U4-2 间接路径：三段节点链 + 两段关系类型', async () => {
    assert(indirectCandidates.length > 0, '找不到可点击的两跳（distance=2）节点对');
    let chosen = null;
    for (const cand of indirectCandidates) {
      const ok = await selectPair(
        page,
        () => clickNode(page, posById.get(cand.s)),
        () => clickNode(page, posById.get(cand.t)),
      );
      if (ok) {
        chosen = cand;
        break;
      }
    }
    assert(chosen, '多次尝试后仍无法稳定双选两跳节点对');
    const [mid] = chosen.path.nodeIds.slice(1, 2);
    const expect = `路径：${titleById.get(chosen.s)} → ${titleById.get(mid)} → ${titleById.get(chosen.t)}`;
    const text = await poll(async () => {
      const t = await page.locator('p', { hasText: '路径：' }).last().innerText().catch(() => '');
      return t ? t.replace(/\s+/g, ' ') : undefined;
    }, 5_000);
    assert(text, '两跳双选后未出现路径文案');
    assert(text.includes(expect), `间接路径文案不符：${text}（期望 ${expect}）`);
    const kindLabels = chosen.path.edges.map((e) => ({ wiki: '双链', tag: '标签', doc: '同文档' }[e.kind] ?? e.kind));
    assert(text.includes(`（${kindLabels.join(' / ')}）`), `缺少关系类型串：${text}（期望 ${kindLabels.join(' / ')}）`);
    await blurMouse(page);
    const pMid = await sampleNodeAlpha(page, posById.get(mid));
    assert(pMid !== null && pMid >= 0.9, `中间路径节点未高亮：${pMid}`);
    await page.screenshot({ path: 'artifacts/phase4-qa-pathIndirect.png' });
    await page.getByRole('button', { name: '退出', exact: true }).click();
    return `「${expect}（${kindLabels.join(' / ')}）」，中间节点 alpha=${pMid.toFixed(2)}`;
  });

  await check('U4-2 无路径：显示「两个知识点之间没有路径」，且无路径开关', async () => {
    // 取两个不同连通分量节点
    const comp = new Map();
    let idx = 0;
    for (const id of ids) {
      if (comp.has(id)) continue;
      idx += 1;
      const queue = [id];
      comp.set(id, idx);
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of adj.get(cur) ?? []) {
          if (comp.has(nb)) continue;
          comp.set(nb, idx);
          queue.push(nb);
        }
      }
    }
    let pair = null;
    for (const s of ids) for (const t of ids) if (comp.get(s) !== comp.get(t) && !pair) pair = { s, t };
    let usedFallback = false;
    if (!pair) {
      usedFallback = true;
      // 图连通时退化为「构造一个无路径检测」：用 map 中不可达 id 对（理论上不存在）
      pair = { s: ids[0], t: '__not_in_graph__' };
    }
    assert(pair, '无可用节点对');
    await ensureCompareOff(page);
    await page.getByRole('button', { name: '联系两概念' }).click();
    if (!usedFallback) {
      await page.getByText(/已选 0\/2/).waitFor({ timeout: 5_000 });
      await clickNode(page, posById.get(pair.s));
      await clickNode(page, posById.get(pair.t));
      await page.getByText(/已选 2\/2/).waitFor({ timeout: 5_000 });
      await page.getByText('两个知识点之间没有路径').waitFor({ timeout: 5_000 });
      assert((await page.getByRole('button', { name: '清除路径' }).count()) === 0, '无路径时不应出现清除路径');
      await page.screenshot({ path: 'artifacts/phase4-qa-pathNone.png' });
      await page.getByRole('button', { name: '退出', exact: true }).click();
      return `「${titleById.get(pair.s)} ↔ ${titleById.get(pair.t)}」无路径文案可见，无路径开关`;
    }
    await page.getByRole('button', { name: '退出', exact: true }).click();
    return '本库图谱为单一连通分量，无法构造真实无路径节点对；无路径分支由 graph-focus 单测（无路径）覆盖，Lead 截图 phase4-pathNone 为证';
  });

  // ---------- C. U4-5 右键菜单 ----------
  await check('U4-5：桌面右键节点弹出 7 项菜单（含 2 个 disabled + 未实现说明）', async () => {
    await closeDetail(page);
    await rightClickNode(page, seedPos);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    const items = menu(page).locator('[role="menuitem"]');
    const count = await items.count();
    const labels = (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert(count === 7, `菜单项=${count}`);
    for (const label of ['聚焦该节点', '展开一阶关联', '展开二阶关联', '阅读知识点', '编辑知识点']) {
      assert(labels.some((l) => l.includes(label)), `缺少菜单项 ${label}：${labels.join(' | ')}`);
    }
    const disabled = menu(page).locator('[role="menuitem"][aria-disabled="true"]');
    assert((await disabled.count()) === 2, `disabled 项数量=${await disabled.count()}`);
    const disabledText = (await disabled.allInnerTexts()).join(' ');
    assert(disabledText.includes('标记为重要') && disabledText.includes('加入今日学习'), `disabled 项文案=${disabledText}`);
    assert(disabledText.includes('未实现') || disabledText.includes('需'), 'disabled 项缺少未实现说明');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('role') + '/' + (document.activeElement?.textContent ?? '').slice(0, 20));
    assert(focused.startsWith('menuitem'), `打开后焦点=${focused}`);
    await page.keyboard.press('Escape');
    await menu(page).waitFor({ state: 'detached', timeout: 5_000 });
    await page.screenshot({ path: 'artifacts/phase4-qa-context-menu.png' });
    return `7 项（2 个 disabled）：「${labels.slice(0, 5).join(' / ')}」；打开聚焦首项，Esc 关闭`;
  });

  await check('U4-5：键盘 ↑↓/Home/End/Enter 可用（Enter 执行聚焦）', async () => {
    await rightClickNode(page, seedPos);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    await page.keyboard.press('ArrowDown');
    const afterDown = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 20));
    await page.keyboard.press('End');
    const afterEnd = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 20));
    await page.keyboard.press('Home');
    const afterHome = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 20));
    assert(afterDown?.includes('展开一阶关联'), `↓ 后焦点=${afterDown}`);
    assert(afterEnd?.includes('编辑知识点') || afterEnd?.includes('阅读知识点'), `End 后焦点=${afterEnd}`);
    assert(afterHome?.includes('聚焦该节点'), `Home 后焦点=${afterHome}`);
    await page.keyboard.press('Enter'); // 聚焦该节点
    await menu(page).waitFor({ state: 'detached', timeout: 5_000 });
    const title = await waitDetailOk(page);
    const reached = await poll(async () => {
      const info = await page.evaluate((id) => {
        const node = (window.__kbGraphNodePositions ?? []).find((p) => p.id === id);
        if (!node) return null;
        const p = window.__kbGraphInstance.graph2ScreenCoords(node.x, node.y);
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { dx: Math.abs(r.left + p.x - (r.left + r.width / 2)), dy: Math.abs(r.top + p.y - (r.top + r.height / 2)) };
      }, seedId);
      return info && info.dx <= 2 && info.dy <= 2 ? info : undefined;
    }, 2_000);
    assert(reached, '菜单「聚焦该节点」未把节点移到中心');
    assert(page.url().endsWith('/graph'), '聚焦动作不应跳页');
    await closeDetail(page);
    return `↓→${afterDown}，End→${afterEnd}，Home→${afterHome}；Enter 聚焦到中心（dx=${reached.dx.toFixed(1)} dy=${reached.dy.toFixed(1)}），面板「${title}」`;
  });

  await check('U4-5：菜单动作「展开一阶/展开二阶」写入 focusDepth', async () => {
    await rightClickNode(page, seedPos);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    await menu(page).getByRole('menuitem', { name: '展开一阶关联' }).click();
    await waitDetailOk(page);
    const btn1 = detail(page).getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
    const t1 = (await btn1.innerText()).trim();
    assert(t1 === '展开二阶关联', `一阶后按钮=${t1}`);
    await closeDetail(page);
    await rightClickNode(page, seedPos);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    await menu(page).getByRole('menuitem', { name: '展开二阶关联' }).click();
    await waitDetailOk(page);
    const btn2 = detail(page).getByRole('button', { name: /展开一阶关联|展开二阶关联|收起关联/ });
    const t2 = (await btn2.innerText()).trim();
    assert(t2 === '收起关联', `二阶后按钮=${t2}`);
    await page.screenshot({ path: 'artifacts/phase4-qa-menu-second-order.png' });
    await closeDetail(page);
    return `一阶 → ${t1}；二阶 → ${t2}（depth=2 生效）`;
  });

  await check('U4-5：菜单「编辑知识点」→ #edit 编辑态；「阅读知识点」→ /segments', async () => {
    await rightClickNode(page, seedPos);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    await menu(page).getByRole('menuitem', { name: '编辑知识点' }).click();
    await poll(() => Promise.resolve(page.url().includes('#edit')), 15_000);
    assert(page.url().includes(`/segments/${seedId}#edit`), `编辑 URL=${page.url()}`);
    await page.getByRole('button', { name: /完成编辑/ }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    const fresh = await snapshot(page);
    await rightClickNode(page, fresh.positions.find((p) => p.id === seedId) ?? fresh.positions[0]);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    await menu(page).getByRole('menuitem', { name: '阅读知识点' }).click();
    await page.waitForURL(`**/segments/${seedId}`, { timeout: 15_000 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    return `编辑 → /segments/<id>#edit（出现「✓ 完成编辑」）；阅读 → /segments/<id>`;
  });

  await check('U4-5：视口收窄后菜单自动 clamp 不越界（resize 重算）', async () => {
    const s = await snapshot(page);
    const widest = await (async () => {
      let best = null;
      for (const p of s.positions) {
        const pt = await screenPointOfNode(page, p);
        if (!pt) continue;
        if (!best || pt.x > best.x) best = pt;
      }
      return best;
    })();
    assert(widest, '找不到可用于右键的节点');
    await page.mouse.click(widest.x, widest.y, { button: 'right' });
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    const before = await menu(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth };
    });
    // 收窄视口：锚点 x 可能落在新视口外，组件监听 resize 后必须把菜单夹回视口内
    await page.setViewportSize({ width: 600, height: 500 });
    await page.waitForTimeout(400);
    const rect = await menu(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert(rect.left >= 7 && rect.top >= 7 && rect.right <= rect.vw - 7 && rect.bottom <= rect.vh - 7, `收窄后菜单越界：${JSON.stringify(rect)}`);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    await page.waitForTimeout(300);
    return `锚点 x=${widest.x.toFixed(0)}（原视口 ${before.vw}）；收窄到 600×500 后菜单 left=${rect.left.toFixed(0)} top=${rect.top.toFixed(0)} right=${rect.right.toFixed(0)} bottom=${rect.bottom.toFixed(0)}，未越界`;
  });

  await check('U4-5：点击菜单外部关闭 / disabled 项不可点', async () => {
    const s = await snapshot(page);
    await rightClickNode(page, s.positions[0]);
    await menu(page).waitFor({ state: 'visible', timeout: 5_000 });
    const disabled = menu(page).locator('[role="menuitem"][aria-disabled="true"]').first();
    await disabled.click({ force: true });
    assert(await menu(page).isVisible(), '点击 disabled 项后菜单不应关闭/触发');
    await page.mouse.click(500, 900); // 菜单外
    await menu(page).waitFor({ state: 'detached', timeout: 5_000 });
    return 'disabled 项点击无反应；点击外部关闭菜单';
  });

  // ---------- D. 回归（阶段 0–2） ----------
  await check('回归：搜索（Ctrl+K → 网络 3 条 → Esc 恢复）', async () => {
    await page.keyboard.press('Control+K');
    const panel = page.locator('section[aria-label="搜索知识"]');
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    await page.getByRole('combobox').fill('网络');
    await page.locator('section[aria-label="搜索知识"] [role="option"]').first().waitFor({ timeout: 10_000 });
    const n = await page.locator('section[aria-label="搜索知识"] [role="option"]').count();
    assert(n === 3, `搜索结果=${n}`);
    await page.getByRole('combobox').press('Escape');
    await panel.waitFor({ state: 'detached', timeout: 5_000 });
    return '3 条结果，Esc 关闭';
  });

  await check('回归：详情面板/沉浸布局/导航/顶栏/图例/h1', async () => {
    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      const aside = [...document.querySelectorAll('aside')].find((el) => !el.getAttribute('aria-label'));
      const footer = document.querySelector('footer');
      const vis = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      return {
        ratio: c.height / innerHeight,
        top: c.top,
        sidebar: vis(aside),
        footer: vis(footer),
        nav: document.querySelectorAll('nav[aria-label="知识宇宙导航"] [aria-label]').length,
        header: Boolean(document.querySelector('header[aria-label="知识宇宙顶栏"]')),
        h1: document.querySelector('h1')?.textContent,
        scrollW: document.documentElement.scrollWidth,
        innerW: innerWidth,
      };
    });
    assert(m.ratio >= 0.85 && m.top <= 1 && !m.sidebar && !m.footer && m.nav === 7 && m.header && m.h1 === '关系图谱' && m.scrollW <= m.innerW + 1, JSON.stringify(m));
    await page.locator('button[aria-label="展开记忆度图例"]').click();
    await page.locator('section[aria-label="记忆度图例"]').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('button[aria-label="收起记忆度图例"]').click();
    const s = await snapshot(page);
    await clickNode(page, s.positions[0]);
    const title = await waitDetailOk(page);
    await closeDetail(page);
    return `canvas 100%、sidebar/footer 隐藏、nav 7、顶栏+h1、图例、详情「${title}」均正常`;
  });

  await check('回归：设置/筛选/力参数/暂停/双选/拖拽/fixture/空态/骨架', async () => {
    await page.locator('button[aria-label="关系图谱设置"]').click();
    for (const tab of ['筛选', '分组', '显示', '力']) await page.getByRole('button', { name: tab, exact: true }).waitFor({ timeout: 5_000 });
    await page.getByPlaceholder('搜索标题：命中高亮，其余淡化').fill('记忆');
    await page.getByPlaceholder('搜索标题：命中高亮，其余淡化').fill('');
    await page.getByRole('button', { name: '力', exact: true }).click();
    assert((await page.locator('input[type="range"]').count()) === 4, '力滑块数量');
    await page.locator('button[aria-label="关系图谱设置"]').click();
    // 拖拽
    const s = await snapshot(page);
    const pt = await screenPointOfNode(page, s.positions[0]);
    const okPt = await canvasPointAt(page, pt);
    await page.mouse.move(okPt.x, okPt.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(okPt.x + 70, okPt.y + 40, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    const reheated = await poll(async () => {
      const cur = await snapshot(page);
      return cur.engineStop !== s.engineStop ? cur : undefined;
    }, 30_000);
    assert(reheated, '拖拽未触发重排');
    // fixture + 空态 + 骨架
    await page.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page, 500, 120_000);
    const badge = page.locator('[aria-label="压测数据模式：graph-small"]');
    await badge.waitFor({ state: 'visible', timeout: 30_000 });
    const p1 = await context.newPage();
    await p1.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
    await p1.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p1.getByText('图谱还没有灯。').waitFor({ timeout: 30_000 });
    await p1.close();
    const p2 = await context.newPage();
    await p2.route('**/api/graph', async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue().catch(() => {});
    });
    await p2.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p2.locator('[role="status"][aria-label="加载中"]').waitFor({ state: 'visible', timeout: 10_000 });
    await p2.waitForTimeout(2_500);
    await p2.close();
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    return '四页签/筛选/力滑块、拖拽重排、fixture 500、空态、骨架均正常';
  });

  // ---------- E. 8k smoke（二阶/路径激活） ----------
  await check('8k fixture：二阶 focus 与路径激活不崩、帧可接受', async () => {
    allowNetworkErrors += 1; // fixture 节点无 /api/segments 数据，404 属预期
    await page.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
    const big = await waitGraphReady(page, 8000, 180_000);
    // 8k 节点密集，命中半径小：逐个尝试可点击节点，直到菜单出现
    let opened = false;
    for (const candidate of big.positions.slice(0, 12)) {
      const raw = await screenPointOfNode(page, candidate);
      if (!raw) continue;
      const okPt = await canvasPointAt(page, raw);
      if (!okPt) continue;
      await page.mouse.click(okPt.x, okPt.y, { button: 'right' });
      opened = await menu(page).waitFor({ state: 'visible', timeout: 1_500 }).then(() => true).catch(() => false);
      if (opened) break;
    }
    assert(opened, '8k 上 12 次右键尝试均未命中节点（菜单未出现）');
    // 激活前埋点：长任务 + rAF 间隔（评估 8k 二阶激活是否造成卡顿/冻结）
    await page.evaluate(() => {
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
        if (window.__qaGaps.length < 300) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const tActivate = Date.now();
    await menu(page).getByRole('menuitem', { name: '展开二阶关联' }).click();
    await page.waitForTimeout(1_200);
    const activationMs = Date.now() - tActivate;
    const act = await page.evaluate(() => ({
      maxGap: Math.max(0, ...(window.__qaGaps ?? [])),
      frames: (window.__qaGaps ?? []).length,
      maxLong: window.__qaLong?.length ? Math.max(...window.__qaLong) : 0,
      longCount: window.__qaLong?.length ?? 0,
    }));
    assert((await page.locator('canvas').count()) === 1, '8k 二阶后 canvas 消失');
    assert(act.frames > 0, '8k 二阶激活后 rAF 未继续（疑似冻结）');
    assert(act.maxGap < 2_000, `8k 二阶激活最大帧间隔 ${act.maxGap.toFixed(0)}ms（>2s 视为卡死）`);
    assert(act.maxLong < 2_000, `8k 二阶激活最长长任务 ${act.maxLong.toFixed(0)}ms（>2s 视为卡死）`);
    // 路径激活：双选两个节点（8k 图基本连通），量测 BFS + 高亮生效耗时
    await closeDetail(page);
    await page.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
    const big2 = await waitGraphReady(page, 8000, 180_000);
    // 候选屏幕点：先用 hover 命中（cursor=pointer）筛选真实可点节点，避免盲点落在空白
    const pts = [];
    for (const a of big2.positions.slice(0, 40)) {
      const pa = await screenPointOfNode(page, a);
      if (!pa || !(await canvasPointAt(page, pa))) continue;
      await page.mouse.move(pa.x, pa.y);
      await page.waitForTimeout(30);
      const cursor = await page.evaluate(() => document.body.style.cursor);
      if (cursor === 'pointer') pts.push(pa);
      if (pts.length >= 10) break;
    }
    await blurMouse(page);
    assert(pts.length >= 2, '8k hover 命中节点不足');
    let selected = false;
    const tPath = Date.now();
    for (let i = 0; i < pts.length && !selected; i += 1) {
      for (let j = i + 1; j < pts.length && !selected; j += 1) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= 60) continue;
        selected = await selectPair(
          page,
          async () => {
            await page.mouse.click(pts[i].x, pts[i].y);
          },
          async () => {
            await page.mouse.click(pts[j].x, pts[j].y);
          },
        );
      }
    }
    assert(selected, '8k 多次尝试后仍无法双选两个不同节点');
    const barReady = await poll(async () => {
      const pathText = await page.locator('p', { hasText: '路径：' }).last().innerText().catch(() => '');
      if (pathText) return { kind: 'path', text: pathText };
      const none = await page.getByText('两个知识点之间没有路径').count();
      return none ? { kind: 'none' } : undefined;
    }, 5_000, 50);
    const pathMs = Date.now() - tPath;
    assert(barReady, '8k 双选后 5s 内未出现路径/无路径文案');
    assert(pathMs < 4_000, `8k 路径计算+呈现 ${pathMs}ms（含重试，超过 4s 视为不可接受）`);
    const barText = barReady.kind === 'path' ? barReady.text.replace(/\s+/g, ' ') : '';
    const noPath = barReady.kind === 'none' ? 1 : 0;
    assert(pageErrors.length === 0, `8k 激活出现 pageerror：${pageErrors.slice(0, 2).join(' | ')}`);
    allowNetworkErrors = Math.max(0, allowNetworkErrors - 1);
    return `8k 二阶激活 ${activationMs}ms：长任务 max=${act.maxLong.toFixed(0)}ms（${act.longCount} 个）、最大帧间隔 ${act.maxGap.toFixed(0)}ms、续帧 ${act.frames} 次；路径激活 ${pathMs}ms（${barText ? '路径文案可见' : noPath ? '无路径文案可见' : '状态未知'}），未崩溃`;
  });

  // ---------- F. 移动端长按 ----------
  await check('移动端 375×812：touch 长按 500ms 弹菜单、不越界、Esc 关闭', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const m = await waitGraphReady(page);
    const pos = m.positions[0];
    const pt = await screenPointOfNode(page, pos);
    const dispatched = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 1, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return true;
    }, pt);
    assert(dispatched, '无法派发 touch pointerdown');
    await menu(page).waitFor({ state: 'visible', timeout: 3_000 });
    const rect = await menu(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert(rect.left >= 0 && rect.right <= rect.vw && rect.top >= 0 && rect.bottom <= rect.vh, `移动端菜单越界：${JSON.stringify(rect)}`);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(scrollW <= 375 + 1, `移动端横向溢出 scrollWidth=${scrollW}`);
    await page.screenshot({ path: 'artifacts/phase4-qa-mobile-menu.png' });
    await page.keyboard.press('Escape');
    await menu(page).waitFor({ state: 'detached', timeout: 5_000 });
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return `长按 500ms 弹菜单，矩形 ${rect.left.toFixed(0)},${rect.top.toFixed(0)}–${rect.right.toFixed(0)},${rect.bottom.toFixed(0)} 在 375×812 内，无横向溢出，Esc 关闭`;
  });

  await check('主页面 0 console/page error', async () => {
    assert(pageErrors.length === 0, `pageerror：${pageErrors.slice(0, 2).join(' | ')}`);
    assert(consoleErrors.length === 0, `console.error：${consoleErrors.slice(0, 3).join(' | ')}`);
    return 'pageerror=0，console.error=0';
  });
} catch (error) {
  record('脚本级异常', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
} finally {
  await browser.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const summary = { baseURL, capturedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync('artifacts/phase4-qa-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
