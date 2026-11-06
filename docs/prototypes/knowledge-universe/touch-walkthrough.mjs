/**
 * T07 补充验收证据 · 移动端触控走查（模拟触控，非真实设备）
 *
 * 重要边界：本脚本用 Playwright hasTouch + CDP touch 事件模拟触屏，
 * 只能验证「浏览器内可量测的交互事实」，**不等价于真实设备走查**，
 * 不能替代真机上的 iOS 安全区、系统手势、浏览器工具栏、触摸反馈与滚动惯性。
 * 真机部分须由人工完成，记录到 docs/T07评审材料.md 的补充验收小节。
 *
 * 完整操作链：进入图谱 → 搜索 → 选中节点 → 展开 Sheet → 执行操作 → 关闭 Sheet → 恢复图谱探索
 * 输出：screenshots/touch-*.png、screenshots/touch-walkthrough.json / .md
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'screenshots');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(join(dir, 'graph.html')).href;

const VIEWPORTS = [
  { name: '320x720', width: 320, height: 720 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
];

const CHECKS = [
  ['sheet-open', 'Sheet 展开：点击节点后展开，节点选中状态保留'],
  ['primary-actions', '主操作可用：展开后阅读 / 回忆 / AI 等入口仍可触达'],
  ['isolation', '底层隔离：操作 Sheet 不意外拖动图谱或触发底层节点'],
  ['scroll', '滚动行为：Sheet 内部滚动正常，页面不跟随滚动'],
  ['close-restore', '关闭与恢复：关闭后图谱位置与选中 / 搜索上下文保留'],
  ['compact-graph', '小屏星图：320px 下节点、关系与当前焦点可辨认'],
  ['path-explore', '路径探索：浮层关闭后仍能选择第二个节点'],
  ['safe-area', '安全区域：底部操作不被工具栏 / 安全区遮挡'],
];

let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
} catch (error) {
  console.log('系统 Chrome 启动失败，改用 Playwright Chromium：', error.message);
  browser = await chromium.launch({ headless: true });
}

async function tapCenter(page, selector, withHit = false) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error('未找到可点击元素：' + selector);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // 诊断必须在 tap 之前、且与真实 tap 使用同一坐标
  const hit = withHit ? await page.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return e ? String(e.className?.baseVal || e.className || e.tagName) : 'none';
  }, point) : null;
  await page.touchscreen.tap(point.x, point.y);
  return hit;
}

async function swipe(cdp, x, fromY, toY, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: fromY + (toY - fromY) * i / steps }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function readState(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#context-list .context-row'));
    return Object.fromEntries(rows.map((r) => [
      r.querySelector('span')?.textContent?.trim() || '',
      r.querySelector('b')?.textContent?.trim() || '',
    ]));
  });
}

async function reachable(page, selector) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return { ok: false, reason: '元素不存在' };
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, reason: '尺寸为 0' };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hit = top ? (top.className?.baseVal || top.className || top.tagName) : 'none';
    return {
      ok: e === top || e.contains(top),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
      hit: String(hit).slice(0, 70),
    };
  }, selector);
}

const results = [];
const pageErrors = [];

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${vp.name}: ${e.message}`));
    const cdp = await context.newCDPSession(page);
    const checks = {};
    const shots = [];

    async function shot(step) {
      const file = `touch-${vp.name}-${step}.png`;
      await page.screenshot({ path: join(out, file), fullPage: false });
      shots.push(file);
    }

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(200);

    // ---- 1) 搜索：完整链路起点 ----
    await tapCenter(page, '#ku-search');
    await page.keyboard.type('记忆', { delay: 30 });
    await page.waitForTimeout(120);
    const searchText = await page.locator('#search-result').textContent();
    if (vp.name === '390x844') await shot('01-search');

    // ---- 2) 选中节点 → Sheet 展开 ----
    await tapCenter(page, '.ku-node[data-node="n2"]');
    await page.waitForTimeout(160);
    const sheetVisible = await page.locator('#ku-overlay').isVisible();
    const stAfterSelect = await readState(page);
    const panelBox = await page.locator('#ku-overlay .overlay-panel').boundingBox();
    const selectedKept = await page.locator('.ku-node.selected').count();
    checks['sheet-open'] = {
      pass: sheetVisible && selectedKept === 1 && stAfterSelect['当前选中节点'] === '记忆新鲜度',
      detail: `Sheet 可见=${sheetVisible}；选中节点="${stAfterSelect['当前选中节点']}"；.selected 数=${selectedKept}；面板高度=${panelBox?.height.toFixed(0)}px / 视口 ${vp.height}px（占比 ${panelBox ? (panelBox.height / vp.height * 100).toFixed(0) : '?'}%）`,
    };
    if (vp.name !== '390x844') await shot('02-sheet');

    // ---- 3) 主操作可达性（Sheet 内 + 底层主操作）----
    const actionChecks = {};
    for (const [key, sel] of [
      ['阅读', '[data-action="read"]'],
      ['主动回忆', '[data-action="recall"]'],
      ['询问 AI', '[data-action="ai"]'],
      ['关闭', '[data-close]'],
      ['继续搜索（等价入口）', '[data-action="sheet-search"]'],
      ['返回图谱（等价入口）', '[data-action="sheet-back"]'],
    ]) actionChecks[key] = await reachable(page, sel);
    const underlying = {
      搜索框: await reachable(page, '#ku-search'),
      模式栏首项: await reachable(page, '#mode-bar button'),
      底部导航: await reachable(page, '.bottom-nav > a'),
    };
    const innerOk = Object.values(actionChecks).every((r) => r.ok && r.inViewport);
    checks['primary-actions'] = {
      pass: innerOk,
      detail: `Sheet 内六项：${Object.entries(actionChecks).map(([k, r]) => k + '=' + (r.ok && r.inViewport ? '可触达' : (r.inViewport ? '被 ' + r.hit + ' 拦截' : '视口外 ' + r.top + '~' + r.bottom))).join('、')}；底层主操作（modal 隔离属预期，须有等价入口）：${Object.entries(underlying).map(([k, r]) => k + '=' + (r.ok ? '可触达' : '被 ' + r.hit + ' 隔离')).join('、')}`,
      underlying,
    };
    if (vp.name === '390x844') await shot('03-sheet-actions');

    // ---- 4) 底层隔离 + 5) 滚动行为（同一段 swipe 取证）----
    const before = await page.evaluate(() => ({
      scrollY: window.scrollY,
      panelScroll: document.querySelector('#ku-overlay .overlay-panel')?.scrollTop ?? 0,
      panelScrollHeight: document.querySelector('#ku-overlay .overlay-panel')?.scrollHeight ?? 0,
      panelClientHeight: document.querySelector('#ku-overlay .overlay-panel')?.clientHeight ?? 0,
    }));
    const panel = await page.locator('#ku-overlay .overlay-panel').boundingBox();
    const swipeX = vp.width / 2;
    const swipeY = Math.min(vp.height - 60, panel.y + Math.min(120, panel.height / 2));
    await swipe(cdp, swipeX, swipeY, Math.max(40, swipeY - 180));
    await page.waitForTimeout(180);
    const after = await page.evaluate(() => ({
      scrollY: window.scrollY,
      panelScroll: document.querySelector('#ku-overlay .overlay-panel')?.scrollTop ?? 0,
    }));
    const stAfterSwipe = await readState(page);
    checks['isolation'] = {
      pass: stAfterSwipe['当前选中节点'] === stAfterSelect['当前选中节点'] &&
        stAfterSwipe['主模式'] === stAfterSelect['主模式'],
      detail: `滑动前/后：主模式 "${stAfterSelect['主模式']}" → "${stAfterSwipe['主模式']}"，选中 "${stAfterSelect['当前选中节点']}" → "${stAfterSwipe['当前选中节点']}"`,
    };
    checks['scroll'] = {
      pass: after.scrollY === before.scrollY,
      detail: `页面 scrollY ${before.scrollY} → ${after.scrollY}；Sheet 内 scrollTop ${before.panelScroll} → ${after.panelScroll}（可滚高度 ${before.panelScrollHeight - before.panelClientHeight}px）`,
    };

    // ---- 6) 执行操作 ----
    await tapCenter(page, '[data-action="ai"]');
    await page.waitForTimeout(140);
    const stAfterAction = await readState(page);
    const actionOk = stAfterAction['主模式'] === 'AI 探索' &&
      stAfterAction['当前选中节点'] === stAfterSelect['当前选中节点'];
    if (vp.name === '390x844') await shot('04-action-ai');

    // ---- 7) 关闭与恢复：点 Sheet 上方遮罩空白 ----
    const panelTop = (await page.locator('#ku-overlay .overlay-panel').boundingBox()).y;
    const blankY = Math.max(8, panelTop - 24);
    await page.touchscreen.tap(vp.width / 2, blankY);
    await page.waitForTimeout(160);
    const stAfterClose = await readState(page);
    const sheetClosed = !(await page.locator('#ku-overlay').isVisible());
    checks['close-restore'] = {
      pass: sheetClosed && actionOk &&
        stAfterClose['当前选中节点'] === stAfterSelect['当前选中节点'] &&
        stAfterClose['当前搜索词与结果'] === stAfterSelect['当前搜索词与结果'],
      detail: `Sheet 已关闭=${sheetClosed}；操作链路生效=${actionOk}；选中 "${stAfterClose['当前选中节点']}"；搜索 "${stAfterClose['当前搜索词与结果']}"；主模式 "${stAfterClose['主模式']}"`,
    };
    if (vp.name === '390x844') await shot('05-restored');

    // ---- 8) 路径探索：关浮层后继续选第二节点 ----
    await tapCenter(page, '#mode-bar button:nth-child(3)'); // 路径探索
    await page.waitForTimeout(100);
    await tapCenter(page, '.ku-node[data-node="n1"]');
    await page.waitForTimeout(100);
    const panelTop2 = (await page.locator('#ku-overlay .overlay-panel').boundingBox()).y;
    await page.touchscreen.tap(vp.width / 2, Math.max(8, panelTop2 - 24));
    await page.waitForTimeout(100);
    const n5Hit = await tapCenter(page, '.ku-node[data-node="n5"]', true);
    await page.waitForTimeout(140);
    const stPath = await readState(page);
    checks['path-explore'] = {
      pass: (stPath['路径起点与终点'] || '').includes('2/2'),
      detail: `路径端点："${stPath['路径起点与终点']}"；主模式 "${stPath['主模式']}"；第二节点 tap 点命中=${n5Hit}`,
    };
    if (vp.name === '390x844') await shot('06-path');

    // ---- 9) 小屏星图可辨认 ----
    const graphVis = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.ku-node').length,
      edges: document.querySelectorAll('.ku-edge').length,
      labels: Array.from(document.querySelectorAll('.ku-node .label'))
        .filter((t) => getComputedStyle(t).display !== 'none').length,
      halo: document.querySelectorAll('.ku-node .halo').length,
      selectedVisible: (() => {
        const e = document.querySelector('.ku-node.selected');
        if (!e) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
      })(),
      selectedLabelVisible: (() => {
        const e = document.querySelector('.ku-node.selected .label');
        return e ? getComputedStyle(e).display !== 'none' : false;
      })(),
      viewBox: document.querySelector('#graph-svg')?.getAttribute('viewBox'),
    }));
    checks['compact-graph'] = {
      pass: graphVis.nodes === 12 && graphVis.edges === 18 && graphVis.halo >= 2 &&
        graphVis.selectedVisible && graphVis.selectedLabelVisible,
      detail: `节点 ${graphVis.nodes} / 关系 ${graphVis.edges} / 可见标签 ${graphVis.labels} / 选中光环 ${graphVis.halo} / 选中节点在视口内=${graphVis.selectedVisible} / 焦点标签可见=${graphVis.selectedLabelVisible} / viewBox=${graphVis.viewBox}`,
    };

    // ---- 10) 安全区域 ----
    await tapCenter(page, '.ku-node[data-node="n2"]').catch(() => {});
    await page.waitForTimeout(120);
    const safe = await page.evaluate(() => {
      const panelEl = document.querySelector('#ku-overlay .overlay-panel');
      if (!panelEl) return null;
      panelEl.scrollTop = panelEl.scrollHeight; // 滚到内容底部后再量最后一项操作
      const cs = getComputedStyle(panelEl);
      const btns = Array.from(panelEl.querySelectorAll('button'));
      const last = btns[btns.length - 1];
      const r = last?.getBoundingClientRect();
      return {
        maxHeight: cs.maxHeight,
        paddingBottom: cs.paddingBottom,
        overscroll: cs.overscrollBehaviorY,
        bodyLocked: document.body.classList.contains('sheet-open'),
        lastButtonBottom: r ? +r.bottom.toFixed(1) : null,
        viewportHeight: window.innerHeight,
        scrollable: panelEl.scrollHeight > panelEl.clientHeight,
        toggle: Boolean(panelEl.querySelector('[data-sheet-toggle]')),
      };
    });
    checks['safe-area'] = {
      pass: Boolean(safe && safe.lastButtonBottom !== null &&
        safe.lastButtonBottom <= safe.viewportHeight + 1 &&
        parseFloat(safe.paddingBottom) >= 20 &&
        safe.overscroll === 'contain' && safe.bodyLocked && safe.toggle && safe.scrollable),
      detail: safe ? `maxHeight=${safe.maxHeight}；paddingBottom=${safe.paddingBottom}；overscroll=${safe.overscroll}；页面滚动锁定=${safe.bodyLocked}；半屏/全屏切换=${safe.toggle}；内容可滚=${safe.scrollable}；最后按钮 bottom=${safe.lastButtonBottom} / 视口 ${safe.viewportHeight}` : '未取得面板',
    };
    if (vp.name === '390x844') await shot('07-safe-area');

    results.push({ viewport: vp.name, width: vp.width, height: vp.height, checks, shots });
    console.log(`\n=== ${vp.name} ===`);
    for (const [id, name] of CHECKS) {
      const c = checks[id];
      console.log(`${c?.pass ? 'PASS' : 'FAIL'}  ${id.padEnd(16)} ${c?.detail || '未执行'}`);
    }
    await context.close();
  }

  const summary = {
    capturedAt: new Date().toISOString(),
    mode: 'simulated-touch',
    realDevice: false,
    note: 'Playwright hasTouch + CDP touch 事件模拟，不等价于真实触屏设备；真机走查须人工完成。',
    viewports: VIEWPORTS.map((v) => v.name),
    pageErrors,
    results,
  };
  writeFileSync(join(out, 'touch-walkthrough.json'), JSON.stringify(summary, null, 2) + '\n');

  const md = [
    '# 移动端触控走查（模拟触控 · 非真机）',
    '',
    `采集时间：${summary.capturedAt}；页面脚本错误：${pageErrors.length}`,
    '',
    '> **边界**：Playwright `hasTouch` + CDP touch 事件模拟，可验证浏览器内可量测的交互事实，**不能替代真实设备**（iOS 安全区、系统手势、浏览器工具栏、滚动惯性、触摸反馈均无法覆盖）。',
    '',
    '| 检查项 | 320x720 | 375x667 | 390x844 |',
    '|---|---|---|---|',
    ...CHECKS.map(([id, name]) => `| ${name} | ` +
      VIEWPORTS.map((v) => (results.find((r) => r.viewport === v.name)?.checks[id]?.pass ? '通过' : '**未通过**')).join(' | ') + ' |'),
    '',
    ...results.flatMap((r) => [
      `### ${r.width}×${r.height}`,
      '',
      ...CHECKS.map(([id]) => `- **${id}**：${r.checks[id]?.pass ? '通过' : '未通过'} — ${r.checks[id]?.detail || '未执行'}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(join(out, 'touch-walkthrough.md'), md + '\n');

  const passCount = results.reduce((n, r) => n + CHECKS.filter(([id]) => r.checks[id]?.pass).length, 0);
  console.log(`\n汇总：模拟触控 ${passCount} / ${CHECKS.length * VIEWPORTS.length} 项通过；页面脚本错误 ${pageErrors.length}`);
} finally {
  await browser.close();
}
