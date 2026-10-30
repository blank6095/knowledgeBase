/**
 * 阶段 1 出口门禁 · QA 独立功能验收（只读源码，只写 artifacts/）。
 *
 * 覆盖 task-10 检查点：
 *  1) 沉浸布局 / 无滚动 / 375 无横向溢出 / sidebar+footer 隐藏 / nav 7 项+外观主题 disabled / 顶栏统计一致
 *  2) 图例 收起→展开→收起
 *  3) 详情面板：单击 ≤300ms、字段与 /api/segments/[id] 一致、loading/error/empty、五操作、移动端 Drawer
 *  4) 点击语义：单击不跳页 / 双击 280ms 内进 /segments（无 hash）/ 双选仍选择 / 空白单击取消
 *  5) 回归：筛选/分组/双选/拖拽/力参数/暂停/箭头/fixture/空态/骨架
 *
 * 用法：$env:KB_PASSCODE 注入；node artifacts/phase1-qa-verify.mjs
 * 依赖 dev server：http://127.0.0.1:3102
 */
import { chromium, request } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
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

async function poll(fn, timeout, interval = 100) {
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

async function waitGraphReady(page, timeout = 90_000) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
  const snap = await poll(async () => {
    const s = await snapshot(page);
    return s.positions.length > 0 ? s : undefined;
  }, timeout);
  assert(snap, '等待图谱节点坐标超时');
  await page.waitForTimeout(300);
  return snapshot(page);
}

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

async function clickNode(page, pos) {
  const pt = await screenPointOfNode(page, pos);
  assert(pt, '无法换算节点屏幕坐标');
  await page.mouse.click(pt.x, pt.y);
  return pt;
}

const detailPanel = (page) => page.locator('aside[aria-label="知识点详情"]');

/** 找一个距所有节点 ≥80px 的画布空白点（避开顶栏/导航/图例区）。 */
async function blankPoint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const pts = (window.__kbGraphNodePositions ?? []).map((n) => {
      const p = window.__kbGraphInstance.graph2ScreenCoords(n.x, n.y);
      return { x: p.x + rect.left, y: p.y + rect.top };
    });
    const candidates = [
      { x: rect.left + 40, y: rect.top + 120 },
      { x: rect.left + rect.width - 60, y: rect.top + rect.height - 100 },
      { x: rect.left + 60, y: rect.top + rect.height - 150 },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height - 150 },
      { x: rect.left + rect.width - 80, y: rect.top + 150 },
    ];
    return candidates.find((c) => pts.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 80)) ?? candidates[0];
  });
}

/** 单次点击 → 面板出现耗时（MutationObserver 打点，含 280ms 单击判定）。 */
async function measurePanelAppearance(page, pos) {
  await page.evaluate(() => {
    window.__qaDetailAt = null;
    window.__qaObserver?.disconnect?.();
    window.__qaObserver = new MutationObserver(() => {
      if (window.__qaDetailAt === null && document.querySelector('aside[aria-label="知识点详情"]')) {
        window.__qaDetailAt = performance.now();
      }
    });
    window.__qaObserver.observe(document.body, { childList: true, subtree: true });
    window.__qaClickAt = performance.now();
  });
  await clickNode(page, pos);
  const at = await poll(() => page.evaluate(() => window.__qaDetailAt), 5_000);
  assert(typeof at === 'number', '面板未在 5s 内出现');
  const delta = await page.evaluate((detailAt) => detailAt - window.__qaClickAt, at);
  await page.evaluate(() => window.__qaObserver?.disconnect?.());
  return delta;
}

async function waitDetailOk(page) {
  const panel = detailPanel(page);
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  await poll(async () => {
    const h = await panel.locator('h2').first().innerText().catch(() => '');
    return h && h !== '加载中…' ? h : undefined;
  }, 15_000);
  return panel;
}

const login = async (page) => {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/`, { timeout: 30_000 });
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });

try {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  /** 错误态用例会主动制造 503，浏览器会打一条网络错误 —— 该窗口内豁免。 */
  let allowNetworkErrors = 0;
  page.on('pageerror', (e) => pageErrors.push(e instanceof Error ? (e.stack ?? String(e)) : String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('favicon')) return;
    if (allowNetworkErrors > 0 && /Failed to load resource|503|Service Unavailable/.test(m.text())) return;
    consoleErrors.push(m.text().slice(0, 300));
  });

  await login(page);
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  const ready = await waitGraphReady(page);
  const apiCtx = await request.newContext({ baseURL });
  await apiCtx.post('/api/auth/login', { data: { passcode } });
  const graphPayload = await (await apiCtx.get('/api/graph')).json();

  // ---------- 1. 沉浸布局 ----------
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const shellAside = [...document.querySelectorAll('aside')].find((el) => !el.getAttribute('aria-label'));
    const footer = document.querySelector('footer');
    const visible = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    };
    return {
      canvas: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      sidebarVisible: visible(shellAside),
      sidebarDisplay: shellAside ? getComputedStyle(shellAside).display : 'absent',
      footerVisible: visible(footer),
      footerDisplay: footer ? getComputedStyle(footer).display : 'absent',
      docScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      h1Count: document.querySelectorAll('h1').length,
      navCount: document.querySelectorAll('nav[aria-label="知识宇宙导航"]').length,
    };
  });

  await check('沉浸布局：canvas 可视面积 ≥85% 视口且贴顶（top≈0）', async () => {
    const ratio = layout.canvas.height / layout.innerHeight;
    assert(layout.canvas.top <= 1, `canvas.top=${layout.canvas.top}`);
    assert(ratio >= 0.85, `canvas 高度 ${layout.canvas.height}/${layout.innerHeight} = ${(ratio * 100).toFixed(1)}% < 85%`);
    return `canvas ${layout.canvas.width}×${layout.canvas.height} @top=${layout.canvas.top}，占视口 ${(ratio * 100).toFixed(1)}%`;
  });

  await check('沉浸布局：无页面级滚动条（横向+纵向都不滚动）', async () => {
    assert(layout.docScrollHeight <= layout.innerHeight + 1, `documentElement.scrollHeight=${layout.docScrollHeight} > ${layout.innerHeight}`);
    assert(layout.bodyScrollHeight <= layout.innerHeight + 1, `body.scrollHeight=${layout.bodyScrollHeight} > ${layout.innerHeight}`);
    assert(layout.docScrollWidth <= layout.innerWidth + 1, `documentElement.scrollWidth=${layout.docScrollWidth} > ${layout.innerWidth}`);
    return `scrollH doc/body=${layout.docScrollHeight}/${layout.bodyScrollHeight}，scrollW=${layout.docScrollWidth}（视口 ${layout.innerWidth}×${layout.innerHeight}）`;
  });

  await check('/graph 下 AppShell 侧边栏隐藏', async () => {
    assert(!layout.sidebarVisible, `侧边栏可见（display=${layout.sidebarDisplay}）`);
    return `sidebar display=${layout.sidebarDisplay}，不可见`;
  });

  await check('/graph 下 AppShell footer 隐藏', async () => {
    assert(!layout.footerVisible, `footer 可见（display=${layout.footerDisplay}）`);
    return `footer display=${layout.footerDisplay}，不可见`;
  });

  await check('悬浮导航：唯一 nav，7 项且外观主题 disabled + hint', async () => {
    assert(layout.navCount === 1, `nav 数量=${layout.navCount}`);
    const nav = page.locator('nav[aria-label="知识宇宙导航"]');
    const labels = await nav.locator('[aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const expectLabels = ['知识宇宙', '知识库', '今日学习', '学习复盘', 'AI 助手'];
    for (const label of expectLabels) assert(labels.includes(label), `缺少导航项 ${label}`);
    const theme = nav.locator('[aria-label*="外观主题"]');
    assert((await theme.count()) === 1, '外观主题项缺失');
    const ariaDisabled = await theme.getAttribute('aria-disabled');
    assert(ariaDisabled === 'true', `外观主题 aria-disabled=${ariaDisabled}`);
    assert((await theme.getAttribute('aria-label')).includes('主题系统（阶段 3 交付）'), '外观主题 hint 文案不符');
    assert(labels.includes('退出登录'), '缺少退出登录');
    const urlBefore = page.url();
    await theme.click({ force: true });
    await page.waitForTimeout(300);
    assert(page.url() === urlBefore, `点击禁用的外观主题后 URL 变化：${page.url()}`);
    assert(labels.length === 7, `导航项数量=${labels.length}（期望 7）`);
    return `${labels.length} 项：${labels.join(' / ')}；外观主题 aria-disabled=true，点击不跳转`;
  });

  await check('悬浮导航：active 标记在「知识宇宙」', async () => {
    const active = page.locator('nav[aria-label="知识宇宙导航"] [aria-current="page"]');
    assert((await active.count()) === 1, `active 数量=${await active.count()}`);
    const label = await active.getAttribute('aria-label');
    assert(label === '知识宇宙', `active=${label}`);
    return 'aria-current=page → 知识宇宙';
  });

  await check('顶栏：品牌 + 搜索位存在，统计与 /api/graph 数据一致', async () => {
    const header = page.locator('header[aria-label="知识宇宙顶栏"]');
    await header.waitFor({ state: 'visible', timeout: 10_000 });
    const text = (await header.innerText()).replace(/\s+/g, ' ');
    assert(text.includes('知识宇宙'), '缺少品牌');
    assert((await header.locator('button[aria-label="搜索知识（Ctrl K）"]').count()) === 1, '缺少搜索位');
    const expected = `${graphPayload.nodes.length} 知识点 · ${graphPayload.edges.length} 关系`;
    const ok = text.includes(`${graphPayload.nodes.length} 知识点`) && text.includes(`${graphPayload.edges.length} 关系`);
    assert(ok, `统计文案="${text}"，期望含 ${expected}`);
    return `统计「${graphPayload.nodes.length} 知识点 · ${graphPayload.edges.length} 关系」与 API nodes=${graphPayload.nodes.length} edges=${graphPayload.edges.length} 一致；搜索位 placeholder「搜索知识、概念、标签…」`;
  });

  await page.screenshot({ path: 'artifacts/phase1-qa-desktop-default.png' });

  // ---------- 2. 图例 ----------
  await check('图例：默认收起 → 展开（四档语义）→ 收起', async () => {
    const collapsed = page.locator('button[aria-label="展开记忆度图例"]');
    await collapsed.waitFor({ state: 'visible', timeout: 5_000 });
    assert((await page.locator('section[aria-label="记忆度图例"]').count()) === 0, '初始不应展开');
    await collapsed.click();
    const section = page.locator('section[aria-label="记忆度图例"]');
    await section.waitFor({ state: 'visible', timeout: 5_000 });
    const text = (await section.innerText()).replace(/\s+/g, ' ');
    assert(text.includes('记忆度'), '展开后缺少「记忆度」标题');
    assert(text.includes('未读'), '展开后缺少「未读」端');
    assert(text.includes('长明'), '展开后缺少「长明」端');
    const tiers = await page.evaluate(() => {
      const nodes = window.__kbGraphNodePositions ?? [];
      return nodes.length;
    });
    await page.screenshot({ path: 'artifacts/phase1-qa-desktop-legend.png' });
    await page.locator('button[aria-label="收起记忆度图例"]').click();
    await collapsed.waitFor({ state: 'visible', timeout: 5_000 });
    assert((await page.locator('section[aria-label="记忆度图例"]').count()) === 0, '收起失败');
    return `收起按钮 → 展开「${text.slice(0, 50)}…」（含未读/长明）→ 收起成功（画布节点 ${tiers}）`;
  });

  // ---------- 3. 详情面板 ----------
  const n0 = ready.positions[0];
  const appearanceSamples = [];
  await check('详情面板：单击节点 ≤300ms 出现（3 次采样，dev 模式）', async () => {
    // 第 1 次：冷启动（面板未打开）
    appearanceSamples.push(await measurePanelAppearance(page, ready.positions[0]));
    await detailPanel(page).waitFor({ state: 'visible', timeout: 5_000 });
    // 第 2/3 次：先空白关面板，再点不同节点
    for (const pos of [ready.positions[1], ready.positions[2]]) {
      const blank = await blankPoint(page);
      await page.mouse.click(blank.x, blank.y);
      await detailPanel(page).waitFor({ state: 'detached', timeout: 5_000 });
      appearanceSamples.push(await measurePanelAppearance(page, pos));
      await detailPanel(page).waitFor({ state: 'visible', timeout: 5_000 });
    }
    const max = Math.max(...appearanceSamples);
    const list = appearanceSamples.map((v) => `${v.toFixed(1)}ms`).join(' / ');
    assert(max <= 300, `面板出现耗时 ${list}（最大 ${max.toFixed(1)}ms > 300ms）`);
    return `实测 ${list}（含 280ms 单击/双击判定窗口 + React 提交；最大 ${max.toFixed(1)}ms）`;
  });

  await check('详情面板：字段与 /api/segments/[id] 一致', async () => {
    // 重新选中 n0（此前 3 次采样会让面板停留在别的节点上）
    const blank = await blankPoint(page);
    if (await detailPanel(page).isVisible().catch(() => false)) {
      await page.mouse.click(blank.x, blank.y);
      await detailPanel(page).waitFor({ state: 'detached', timeout: 5_000 });
    }
    const current = await snapshot(page);
    const target = current.positions.find((p) => p.id === n0.id) ?? current.positions[0];
    await clickNode(page, target);
    const panel = await waitDetailOk(page);
    const res = await (await apiCtx.get(`/api/segments/${target.id}`)).json();
    const seg = res.segment;
    const docTitle = res.document?.title ?? null;
    const refs = res.refs ?? {};
    const uniq = new Set();
    for (const item of [
      ...(refs.outgoing ?? []),
      ...(refs.incoming ?? []),
      ...(refs.relatedTags ?? []),
      ...(refs.prev ? [refs.prev] : []),
      ...(refs.next ? [refs.next] : []),
    ]) uniq.add(item.id);
    const expectedNeighbors = uniq.size;
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    const h2 = (await panel.locator('h2').first().innerText()).trim();
    assert(h2 === seg.title, `标题 "${h2}" ≠ API "${seg.title}"`);
    if (docTitle) assert(text.includes(docTitle), `缺少文档名 ${docTitle}`);
    else assert(text.includes('未归入文档'), '空文档未显示「未归入文档」');
    const pct = `${(seg.memory * 100).toFixed(0)}%`;
    assert(text.includes(pct), `缺少记忆度百分比 ${pct}`);
    assert(text.includes(`关联 ${expectedNeighbors}`), `关联数不是 ${expectedNeighbors}：${text.slice(0, 120)}`);
    if (seg.headingPath) assert(text.includes(seg.headingPath), `缺少路径 ${seg.headingPath}`);
    if (seg.summary) assert(text.includes(seg.summary.slice(0, 12)), '缺少摘要');
    else assert(text.includes('暂无摘要'), '无摘要时未显示「暂无摘要」');
    for (const tag of seg.tags ?? []) assert(text.includes(`#${tag}`), `缺少标签 #${tag}`);
    return `标题/文档/记忆度 ${pct}/关联 ${expectedNeighbors}/路径/摘要/标签 与 API 一致（segment=${target.id.slice(0, 8)}…）`;
  });

  await check('详情面板：loading 态（延迟响应显示骨架）', async () => {
    const target = ready.positions[3] ?? ready.positions[0];
    await page.route('**/api/segments/*', async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue().catch(() => {});
    });
    await clickNode(page, target);
    await detailPanel(page).waitFor({ state: 'visible', timeout: 5_000 });
    const skeleton = page.locator('[role="status"][aria-label="详情加载中"]');
    await skeleton.waitFor({ state: 'visible', timeout: 5_000 });
    await waitDetailOk(page);
    await page.unroute('**/api/segments/*');
    return '延迟 1.5s 时出现 role=status「详情加载中」骨架，随后恢复 ok 态';
  });

  await check('详情面板：error 态（接口 503 显示错误 + 重试）', async () => {
    const target = ready.positions[4] ?? ready.positions[1];
    await page.route('**/api/segments/*', (route) => route.fulfill({ status: 503, json: { error: '服务暂时不可用（示例）' } }));
    allowNetworkErrors += 1;
    await clickNode(page, target);
    const retry = page.getByRole('button', { name: '重试' });
    await retry.waitFor({ state: 'visible', timeout: 10_000 });
    const text = (await detailPanel(page).innerText()).replace(/\s+/g, ' ');
    assert(/失败|不可用/.test(text), `错误态文案缺失：${text.slice(0, 80)}`);
    await page.unroute('**/api/segments/*');
    await retry.click();
    await waitDetailOk(page);
    allowNetworkErrors = Math.max(0, allowNetworkErrors - 1);
    return `503 → 错误提示 + 重试按钮；重试后恢复 ok（${text.slice(0, 40)}…）`;
  });

  await check('详情面板：空态（无文档/无摘要/无关联）', async () => {
    const target = ready.positions[5] ?? ready.positions[2];
    await page.route('**/api/segments/*', (route) =>
      route.fulfill({
        json: {
          segment: { id: target.id, title: '空态知识点', headingPath: '', tags: [], memory: 0, summary: null },
          document: null,
          refs: { outgoing: [], incoming: [], prev: null, next: null, relatedTags: [] },
        },
      }),
    );
    try {
      // 先关掉上一个面板，避免点击点被面板遮挡
      const blank = await blankPoint(page);
      if (await detailPanel(page).isVisible().catch(() => false)) {
        await page.mouse.click(blank.x, blank.y);
        await detailPanel(page).waitFor({ state: 'detached', timeout: 5_000 });
      }
      await clickNode(page, target);
      const panel = await waitDetailOk(page);
      const text = (await panel.innerText()).replace(/\s+/g, ' ');
      assert(text.includes('未归入文档'), `缺少未归入文档：${text.slice(0, 100)}`);
      assert(text.includes('暂无摘要'), '缺少暂无摘要');
      assert(text.includes('暂无直接关联'), '缺少暂无直接关联');
      return '无文档→未归入文档；无摘要→暂无摘要；无邻居→暂无直接关联';
    } finally {
      await page.unroute('**/api/segments/*');
    }
  });

  // 重新选中首个节点，验证五操作
  await check('详情面板：五操作齐全且「展开一阶关联」aria-pressed 切换', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    const panel = await waitDetailOk(page);
    for (const label of ['阅读知识', '开始复习', 'AI 解释', '编辑知识点']) {
      assert((await panel.getByRole('button', { name: label, exact: true }).count()) === 1, `缺少操作 ${label}`);
    }
    const focusBtn = panel.getByRole('button', { name: /展开一阶关联|收起一阶关联/ });
    assert((await focusBtn.getAttribute('aria-pressed')) === 'false', '初始 aria-pressed 不是 false');
    await focusBtn.click();
    await page.waitForTimeout(300);
    assert((await focusBtn.getAttribute('aria-pressed')) === 'true', '展开后 aria-pressed 不是 true');
    const text = (await focusBtn.innerText()).trim();
    assert(text.includes('收起'), `文案未切换：${text}`);
    await focusBtn.click();
    await page.waitForTimeout(200);
    assert((await focusBtn.getAttribute('aria-pressed')) === 'false', '再次点击未复位');
    return '五操作齐全；展开一阶关联 aria-pressed false→true→false，文案 展开↔收起';
  });

  await check('详情面板：阅读知识 → /segments/[id]', async () => {
    const id = ready.positions[0].id;
    const panel = await waitDetailOk(page);
    await panel.getByRole('button', { name: '阅读知识', exact: true }).click();
    await page.waitForURL(`**/segments/${id}`, { timeout: 15_000 });
    return `→ ${new URL(page.url()).pathname}`;
  });

  await check('详情面板：开始复习 → /study/[id]', async () => {
    const id = ready.positions[0].id;
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    const panel = await waitDetailOk(page);
    await panel.getByRole('button', { name: '开始复习', exact: true }).click();
    await page.waitForURL(`**/study/${id}`, { timeout: 15_000 });
    return `→ ${new URL(page.url()).pathname}`;
  });

  await check('详情面板：编辑知识点 → /segments/[id]#edit 且进入编辑态', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    const panel = await waitDetailOk(page);
    await panel.getByRole('button', { name: '编辑知识点', exact: true }).click();
    await poll(() => Promise.resolve(page.url().includes('#edit')), 15_000);
    const url = page.url();
    assert(url.includes('#edit'), `URL 不含 #edit：${url}`);
    const done = page.getByRole('button', { name: /完成编辑/ });
    await done.waitFor({ state: 'visible', timeout: 30_000 });
    await page.screenshot({ path: 'artifacts/phase1-qa-edit-deeplink.png' });
    return `→ ${new URL(url).pathname}#edit，出现「✓ 完成编辑」`;
  });

  await check('详情面板：AI 解释 → /ask', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    const panel = await waitDetailOk(page);
    await panel.getByRole('button', { name: 'AI 解释', exact: true }).click();
    await page.waitForURL('**/ask', { timeout: 15_000 });
    return `→ ${new URL(page.url()).pathname}`;
  });

  // ---------- 4. 点击语义 ----------
  await check('单击语义：单击节点不跳页、仅开面板', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    await page.waitForTimeout(700);
    assert(page.url().endsWith('/graph'), `单击后 URL=${page.url()}`);
    await detailPanel(page).waitFor({ state: 'visible', timeout: 5_000 });
    return 'URL 保持 /graph，面板出现';
  });

  await check('双击语义：280ms 内双击同节点进入 /segments/[id]（无 hash）', async () => {
    const id = ready.positions[0].id;
    const pt = await screenPointOfNode(page, ready.positions[0]);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(80);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForURL(`**/segments/${id}`, { timeout: 15_000 });
    const url = new URL(page.url());
    assert(url.pathname === `/segments/${id}`, `pathname=${url.pathname}`);
    assert(!url.hash, `URL 带 hash：${url.hash}`);
    return `→ ${url.pathname}（无 hash）`;
  });

  await check('双选模式：单击节点仍是选择、不跳页', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await page.getByRole('button', { name: '联系两概念' }).click();
    await page.getByText(/已选 0\/2/).waitFor({ timeout: 5_000 });
    await clickNode(page, fresh.positions[0]);
    await page.getByText(/已选 1\/2/).waitFor({ timeout: 5_000 });
    assert(page.url().endsWith('/graph'), `双选单击后 URL=${page.url()}`);
    return '已选 1/2，URL 保持 /graph';
  });

  await check('空白单击：关闭详情面板', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    await clickNode(page, fresh.positions[0]);
    await detailPanel(page).waitFor({ state: 'visible', timeout: 5_000 });
    const blank = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      const pts = (window.__kbGraphNodePositions ?? []).map((n) => {
        const p = window.__kbGraphInstance.graph2ScreenCoords(n.x, n.y);
        return { x: p.x + rect.left, y: p.y + rect.top };
      });
      const candidates = [
        { x: rect.left + 40, y: rect.top + 90 },
        { x: rect.left + rect.width - 60, y: rect.top + rect.height - 90 },
        { x: rect.left + 60, y: rect.top + rect.height - 120 },
        { x: rect.left + rect.width / 2, y: rect.top + rect.height - 130 },
      ];
      return candidates.find((c) => pts.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 80)) ?? candidates[0];
    });
    await page.mouse.click(blank.x, blank.y);
    await detailPanel(page).waitFor({ state: 'detached', timeout: 5_000 });
    return `空白点 (${blank.x.toFixed(0)}, ${blank.y.toFixed(0)}) 单击后面板关闭`;
  });

  // ---------- 5. 回归 ----------
  await check('回归：设置面板四页签 + 搜索 + 复选框 + 分组 + 箭头/暂停/滑块 + 力参数', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    await page.locator('button[aria-label="关系图谱设置"]').click();
    for (const tab of ['筛选', '分组', '显示', '力']) {
      await page.getByRole('button', { name: tab, exact: true }).waitFor({ timeout: 5_000 });
    }
    const search = page.getByPlaceholder('搜索标题：命中高亮，其余淡化');
    await search.fill('记忆');
    assert((await search.inputValue()) === '记忆', '搜索输入失效');
    await search.fill('');
    const boxes = page.locator('input[type="checkbox"]');
    const total = await boxes.count();
    assert(total >= 7, `复选框数量=${total}`);
    await boxes.first().click();
    await boxes.first().click();
    await page.getByRole('button', { name: '分组', exact: true }).click();
    await page.getByPlaceholder('关键词…').fill('记忆');
    await page.getByRole('button', { name: '添加' }).click();
    const row = page.locator('input[value="记忆"]');
    await row.waitFor({ timeout: 5_000 });
    await page.locator('button[aria-label="删除分组"]').last().click();
    await page.getByRole('button', { name: '显示', exact: true }).click();
    const arrow = page.locator('label', { hasText: '连线方向箭头' }).locator('input[type="checkbox"]');
    const before = await arrow.isChecked();
    await arrow.click();
    assert((await arrow.isChecked()) !== before, '箭头开关失败');
    const pause = page.getByRole('button', { name: /暂停动画|继续动画/ });
    const p1 = (await pause.innerText()).trim();
    await pause.click();
    const p2 = (await pause.innerText()).trim();
    assert(p1 !== p2, '暂停按钮文案未变化');
    await pause.click();
    await page.getByRole('button', { name: '力', exact: true }).click();
    const sliders = page.locator('input[type="range"]');
    assert((await sliders.count()) === 4, `力滑块=${await sliders.count()}`);
    await sliders.nth(1).evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '220');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    assert((await page.locator('label', { hasText: '斥力' }).first().innerText()).includes('220'), '斥力未生效');
    await page.locator('button[aria-label="关系图谱设置"]').click();
    return '筛选/分组/显示/力 页签、搜索、7 复选框、分组增删、箭头、暂停、4 力滑块全部正常';
  });

  await check('回归：拖拽节点产生重排（新坐标快照）', async () => {
    const before = await snapshot(page);
    const target = before.positions[0];
    const pt = await screenPointOfNode(page, target);
    await page.mouse.move(pt.x, pt.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(pt.x + 80, pt.y + 50, { steps: 14 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    const after = await poll(async () => {
      const s = await snapshot(page);
      return s.engineStop !== before.engineStop ? s : undefined;
    }, 45_000);
    assert(after, '拖拽后引擎未重新停止');
    const start = new Map(before.positions.map((n) => [n.id, n])).get(target.id);
    const end = new Map(after.positions.map((n) => [n.id, n])).get(target.id);
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    assert(moved > 3, `位移 ${moved.toFixed(2)}px`);
    return `节点位移 ${moved.toFixed(1)}px，engineStop 更新`;
  });

  await check('回归：?fixture=graph-small（500 节点、统计一致、可视面积 ≥85%）', async () => {
    await page.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page, 120_000);
    const badge = page.locator('[aria-label="压测数据模式：graph-small"]');
    await badge.waitFor({ state: 'visible', timeout: 60_000 });
    const headerText = (await page.locator('header[aria-label="知识宇宙顶栏"]').innerText()).replace(/\s+/g, ' ');
    assert(headerText.includes('500 知识点'), `统计未显示 500 知识点：${headerText}`);
    const snap = await poll(async () => {
      const s = await snapshot(page);
      return s.positions.length === 500 ? s : undefined;
    }, 120_000);
    assert(snap, '未等到 500 节点快照');
    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      return { ratio: c.height / window.innerHeight, top: c.top };
    });
    assert(m.ratio >= 0.85 && m.top <= 1, `canvas 占比 ${(m.ratio * 100).toFixed(1)}%`);
    await page.screenshot({ path: 'artifacts/phase1-qa-desktop-fixture.png' });
    return `badge 可见，统计 500 知识点，节点 500，canvas 占比 ${(m.ratio * 100).toFixed(1)}%`;
  });

  await check('回归：加载骨架（延迟 /api/graph）', async () => {
    const p = await context.newPage();
    await p.route('**/api/graph', async (route) => {
      await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p.locator('[role="status"][aria-label="加载中"]').waitFor({ state: 'visible', timeout: 10_000 });
    await p.waitForTimeout(3_000);
    await p.close();
    return '延迟 2.5s 时显示 role=status「加载中」';
  });

  await check('回归：空态（nodes=[] 显示「图谱还没有灯。」+ 去导入）', async () => {
    const p = await context.newPage();
    await p.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
    await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await p.getByText('图谱还没有灯。').waitFor({ timeout: 30_000 });
    const link = p.getByRole('link', { name: '去导入' });
    assert(await link.isVisible(), '去导入不可见');
    assert((await link.getAttribute('href')) === '/import', '去导入 href 不对');
    const navCount = await p.locator('nav[aria-label="知识宇宙导航"]').count();
    assert(navCount === 1, `空态下悬浮导航缺失（${navCount}）`);
    await p.close();
    return '空态文案 + 去导入 + 悬浮导航保留';
  });

  await check('回归：AppShell 沉浸模式仅作用于 /graph（/notes 仍有 sidebar+footer）', async () => {
    await page.goto(`${baseURL}/notes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const aside = [...document.querySelectorAll('aside')].find((el) => !el.getAttribute('aria-label'));
      const footer = document.querySelector('footer');
      const vis = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && el.getBoundingClientRect().width > 0;
      };
      return { sidebar: vis(aside), footer: vis(footer) };
    });
    assert(state.sidebar, '/notes 侧边栏不可见（沉浸模式误伤）');
    assert(state.footer, '/notes footer 不可见（沉浸模式误伤）');
    return '/notes 侧边栏+footer 正常可见';
  });

  // ---------- 6. 移动端 375×812 ----------
  await check('移动端 375×812：无横向溢出、canvas ≥85%、导航在底部、Drawer 在导航之上', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    const fresh = await waitGraphReady(page);
    const m = await page.evaluate(() => {
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      const nav = document.querySelector('nav[aria-label="知识宇宙导航"]').getBoundingClientRect();
      const aside = [...document.querySelectorAll('aside')].find((el) => !el.getAttribute('aria-label'));
      const footer = document.querySelector('footer');
      const vis = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && el.getBoundingClientRect().width > 0;
      };
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        canvas: { top: canvas.top, height: canvas.height },
        nav: { top: nav.top, bottom: nav.bottom, height: nav.height },
        sidebarVisible: vis(aside),
        footerVisible: vis(footer),
      };
    });
    assert(m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth} > innerWidth=${m.innerWidth}`);
    assert(m.bodyScrollWidth <= m.innerWidth + 1, `body.scrollWidth=${m.bodyScrollWidth} > ${m.innerWidth}`);
    assert(m.canvas.height / m.innerHeight >= 0.85, `canvas 占比 ${(m.canvas.height / m.innerHeight * 100).toFixed(1)}%`);
    assert(!m.sidebarVisible, '移动端侧边栏可见');
    assert(!m.footerVisible, '移动端 footer 可见');
    assert(m.nav.top > m.innerHeight * 0.6, `底部导航位置异常 top=${m.nav.top}`);
    await page.screenshot({ path: 'artifacts/phase1-qa-mobile-default.png' });

    await clickNode(page, fresh.positions[0]);
    const panel = detailPanel(page);
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(400);
    const geo = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="知识点详情"]');
      const panelRect = aside.getBoundingClientRect();
      const navEl = document.querySelector('nav[aria-label="知识宇宙导航"]');
      const nav = navEl.getBoundingClientRect();
      const cx = nav.left + nav.width / 2;
      const cy = nav.top + nav.height / 2;
      const stack = document.elementsFromPoint(cx, cy).map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`);
      const navInStack = document.elementsFromPoint(cx, cy).some((el) => el === navEl || el.closest('nav') === navEl);
      return {
        panel: { top: panelRect.top, bottom: panelRect.bottom, height: panelRect.height },
        nav: { top: nav.top, bottom: nav.bottom, height: nav.height },
        overlap: Math.max(0, Math.min(panelRect.bottom, nav.bottom) - Math.max(panelRect.top, nav.top)),
        navInStack,
        hit: stack[0] ?? null,
        stackTop3: stack.slice(0, 3),
      };
    });
    await page.screenshot({ path: 'artifacts/phase1-qa-mobile-detail.png' });
    assert(geo.panel.top < geo.nav.top, `Drawer 未在导航之上：panel.top=${geo.panel.top.toFixed(0)} nav.top=${geo.nav.top.toFixed(0)}`);
    assert(geo.navInStack, `导航被 Drawer 遮挡：命中栈 ${geo.stackTop3.join(' > ')}；panel=${JSON.stringify(geo.panel)} nav=${JSON.stringify(geo.nav)}`);
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return `无横向溢出（scrollWidth=${m.scrollWidth}）；canvas ${(m.canvas.height / m.innerHeight * 100).toFixed(1)}%；nav top=${m.nav.top.toFixed(0)} bottom=${m.nav.bottom.toFixed(0)}；panel top=${geo.panel.top.toFixed(0)} bottom=${geo.panel.bottom.toFixed(0)}（与 nav 重叠 ${geo.overlap.toFixed(0)}px，nav 中心命中=${geo.navInStack}，命中元素 ${geo.hit}）`;
  });

  await check('无 console/page error（主页面累计）', async () => {
    assert(pageErrors.length === 0, `pageerror：${pageErrors.slice(0, 2).join(' | ')}`);
    assert(consoleErrors.length === 0, `console.error：${consoleErrors.slice(0, 3).join(' | ')}`);
    return `pageerror=0，console.error=0`;
  });
} catch (error) {
  record('脚本级异常', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
} finally {
  await browser.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const summary = { baseURL, capturedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync('artifacts/phase1-qa-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
