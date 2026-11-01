/**
 * U4-6 小地图出口门禁 · QA 功能验收（只写 artifacts/）。
 * 覆盖：默认关闭/开启/关闭、点击与拖动相机跳转、0 业务请求、engineStop/坐标不变、
 *      小地图视口矩形刷新、桌面与 375 布局不遮挡、8k smoke、阶段 0–4 回归。
 */
import { chromium } from 'playwright';
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
const camera = (page) =>
  page.evaluate(() => {
    const fg = window.__kbGraphInstance;
    const c = typeof fg.centerAt === 'function' ? fg.centerAt() : null;
    return { center: c ? { x: c.x, y: c.y } : null, zoom: typeof fg.zoom === 'function' ? fg.zoom() : null };
  });
const minimap = (page) => page.locator('canvas[aria-label="图谱小地图：显示全图和当前视口，点击或拖动可跳转"]');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 200));
});
const business = [];
page.on('request', (req) => {
  if (/\/api\/(graph|segments|learning|stats|notes)|\/fixtures\//.test(req.url())) business.push({ url: req.url(), at: Date.now() });
});

try {
const login = async (page) => {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('访问口令');
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  const submit = page.getByRole('button', { name: '进入' });
  for (let i = 0; i < 40; i += 1) {
    await input.fill(passcode);
    await page.waitForTimeout(200);
    if (await submit.isEnabled().catch(() => false)) break;
  }
  await submit.click();
  await page.waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout: 60_000 });
};
  await login(page);
  const base = await waitGraphReady(page);

  await check('默认关闭：小地图不出现', async () => {
    assert((await minimap(page).count()) === 0, '默认应无小地图');
    return '无小地图（默认关闭）';
  });

  await check('显示 tab 勾选后出现 168×112 小地图，且 0 业务请求', async () => {
    const reqBefore = business.length;
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.getByRole('button', { name: '显示', exact: true }).click();
    const label = page.locator('label', { hasText: '小地图（全景导航）' }).first();
    await label.locator('input[type="checkbox"]').click();
    await minimap(page).waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForTimeout(400);
    const m = await minimap(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert(m.w === 168 && m.h === 112, `小地图尺寸=${m.w}×${m.h}`);
    assert(m.right <= m.vw - 8 && m.bottom <= m.vh - 8, `小地图越界 ${JSON.stringify(m)}`);
    assert(business.length === reqBefore, `开启触发业务请求：${JSON.stringify(business.slice(reqBefore))}`);
    await page.screenshot({ path: 'artifacts/phase7-qa-minimap-on.png' });
    return `168×112 @右下角（right=${m.right.toFixed(0)} bottom=${m.bottom.toFixed(0)}），0 业务请求`;
  });

  await check('点击小地图跳转相机：center 变化、zoom 不变、engineStop/坐标不变、0 请求', async () => {
    const before = await camera(page);
    const snapBefore = await snapshot(page);
    const reqBefore = business.length;
    const r = await minimap(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, w: rect.width, h: rect.height };
    });
    // 点左下角（Lead 同口径）
    await page.mouse.click(r.left + 10, r.top + r.h - 10);
    await page.waitForTimeout(500);
    const after = await camera(page);
    const snapAfter = await snapshot(page);
    const dx = Math.abs(after.center.x - before.center.x);
    const dy = Math.abs(after.center.y - before.center.y);
    assert(dx + dy > 5, `相机未移动：${JSON.stringify(before.center)} → ${JSON.stringify(after.center)}`);
    assert(Math.abs(after.zoom - before.zoom) < 1e-6, `zoom 变化 ${before.zoom} → ${after.zoom}`);
    assert(snapAfter.engineStop === snapBefore.engineStop, 'engineStop 变化');
    assert(JSON.stringify(snapAfter.positions) === JSON.stringify(snapBefore.positions), '节点坐标变化');
    assert(business.length === reqBefore, `点击触发业务请求：${JSON.stringify(business.slice(reqBefore))}`);
    await page.screenshot({ path: 'artifacts/phase7-qa-minimap-jump.png' });
    return `center (${before.center.x.toFixed(1)},${before.center.y.toFixed(1)}) → (${after.center.x.toFixed(1)},${after.center.y.toFixed(1)})，zoom=${after.zoom?.toFixed(2)} 不变，engineStop/坐标不变，0 请求`;
  });

  await check('拖动小地图连续跳转相机（pointer 拖动），0 请求、engineStop 不变', async () => {
    const before = await camera(page);
    const snapBefore = await snapshot(page);
    const reqBefore = business.length;
    const r = await minimap(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, w: rect.width, h: rect.height };
    });
    const cx = r.left + r.w / 2;
    const cy = r.top + r.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(r.left + r.w - 12, r.top + 12, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await camera(page);
    const moved = Math.abs(after.center.x - before.center.x) + Math.abs(after.center.y - before.center.y);
    assert(moved > 5, `拖动后相机未变化：${JSON.stringify(before.center)} → ${JSON.stringify(after.center)}`);
    const snapAfter = await snapshot(page);
    assert(snapAfter.engineStop === snapBefore.engineStop, 'engineStop 变化');
    assert(business.length === reqBefore, `拖动触发业务请求：${JSON.stringify(business.slice(reqBefore))}`);
    return `拖动后 center 位移=${moved.toFixed(1)}，engineStop 不变，0 请求`;
  });

  await check('小地图视口矩形随相机刷新（画布像素随点击变化）', async () => {
    const read = () =>
      minimap(page).evaluate((el) => {
        const ctx = el.getContext('2d');
        const d = ctx.getImageData(0, 0, el.width, el.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum;
      });
    const a = await read();
    const r = await minimap(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, w: rect.width, h: rect.height };
    });
    await page.mouse.click(r.left + r.w - 20, r.top + 20);
    await page.waitForTimeout(500);
    const b = await read();
    assert(a !== b, `小地图像素未变化（视口矩形未刷新）：${a} → ${b}`);
    return `视口矩形重绘（像素和 ${a} → ${b}）`;
  });

  await check('取消勾选后小地图消失', async () => {
    const tab = page.getByRole('button', { name: '显示', exact: true });
    if (!(await tab.isVisible().catch(() => false))) {
      await page.locator('button[aria-label="关系图谱设置"]').click();
      await tab.waitFor({ timeout: 8_000 });
    }
    await tab.click();
    const label = page.locator('label', { hasText: '小地图（全景导航）' }).first();
    await label.locator('input[type="checkbox"]').click();
    await minimap(page).waitFor({ state: 'detached', timeout: 5_000 });
    return '小地图已移除';
  });

  await check('桌面布局：小地图不与图例/导航/操作区重叠', async () => {
    const tab = page.getByRole('button', { name: '显示', exact: true });
    if (!(await tab.isVisible().catch(() => false))) {
      await page.locator('button[aria-label="关系图谱设置"]').click();
      await tab.waitFor({ timeout: 8_000 });
    }
    await tab.click();
    await page.locator('label', { hasText: '小地图（全景导航）' }).first().locator('input[type="checkbox"]').click();
    await minimap(page).waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const mini = document.querySelector('canvas[aria-label="图谱小地图：显示全图和当前视口，点击或拖动可跳转"]').getBoundingClientRect();
      const legend = document.querySelector('button[aria-label="展开记忆度图例"]').getBoundingClientRect();
      const entry = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('◉ 学习地图'))?.getBoundingClientRect();
      const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return {
        mini: { left: mini.left, top: mini.top, right: mini.right, bottom: mini.bottom },
        legend: { left: legend.left, top: legend.top, right: legend.right, bottom: legend.bottom },
        legendOverlap: overlap(mini, legend),
        entryOverlap: entry ? overlap(mini, entry) : false,
      };
    });
    assert(!m.legendOverlap, `小地图与图例重叠：${JSON.stringify(m)}`);
    assert(!m.entryOverlap, `小地图与「学习地图」入口重叠：${JSON.stringify(m)}`);
    return `小地图(${m.mini.left.toFixed(0)},${m.mini.top.toFixed(0)}–${m.mini.right.toFixed(0)},${m.mini.bottom.toFixed(0)}) 不与图例/入口重叠`;
  });

  await check('移动端 375：小地图不遮挡底部导航、不越界、无横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.getByRole('button', { name: '显示', exact: true }).click();
    await page.locator('label', { hasText: '小地图（全景导航）' }).first().locator('input[type="checkbox"]').click();
    await minimap(page).waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const mini = document.querySelector('canvas[aria-label="图谱小地图：显示全图和当前视口，点击或拖动可跳转"]').getBoundingClientRect();
      const nav = document.querySelector('nav[aria-label="知识宇宙导航"]').getBoundingClientRect();
      return {
        mini: { left: mini.left, top: mini.top, right: mini.right, bottom: mini.bottom },
        nav: { top: nav.top, bottom: nav.bottom },
        scrollW: document.documentElement.scrollWidth,
        innerW: innerWidth,
      };
    });
    assert(m.mini.left >= 0 && m.mini.right <= m.innerW, `小地图横向越界：${JSON.stringify(m.mini)}`);
    assert(m.mini.bottom <= m.nav.top + 1, `小地图遮挡底部导航：mini.bottom=${m.mini.bottom} nav.top=${m.nav.top}`);
    assert(m.scrollW <= m.innerW + 1, `横向溢出 ${m.scrollW}`);
    await page.screenshot({ path: 'artifacts/phase7-qa-minimap-mobile.png' });
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return `小地图 ${m.mini.left.toFixed(0)}–${m.mini.right.toFixed(0)} / ${m.mini.top.toFixed(0)}–${m.mini.bottom.toFixed(0)}，导航 top=${m.nav.top.toFixed(0)}，不重叠、无横向溢出`;
  });

  await check('8k fixture 开启小地图：不崩、记录 long task/帧间隔', async () => {
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
      const t0 = Date.now();
      await p.locator('button[aria-label="关系图谱设置"]').click();
      await p.getByRole('button', { name: '显示', exact: true }).click();
      await p.locator('label', { hasText: '小地图（全景导航）' }).first().locator('input[type="checkbox"]').click();
      await p.locator('canvas[aria-label="图谱小地图：显示全图和当前视口，点击或拖动可跳转"]').waitFor({ state: 'visible', timeout: 10_000 });
      await p.waitForTimeout(1_200);
      const enabledMs = Date.now() - t0;
      const m = await p.evaluate(() => ({
        maxLong: window.__qaLong?.length ? Math.max(...window.__qaLong) : 0,
        maxGap: Math.max(0, ...(window.__qaGaps ?? [])),
        frames: (window.__qaGaps ?? []).length,
        canvases: document.querySelectorAll('canvas').length,
      }));
      assert(m.canvases >= 2, `canvas 数量=${m.canvases}（应含图 + 小地图）`);
      assert(m.frames > 0, 'rAF 停止');
      assert(m.maxGap < 2_000, `最大帧间隔 ${m.maxGap.toFixed(0)}ms`);
      assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
      await p.screenshot({ path: 'artifacts/phase7-qa-minimap-8k.png' });
      return `8k 开启 ${enabledMs}ms：longTask max=${m.maxLong.toFixed(0)}ms、帧间隔 max=${m.maxGap.toFixed(0)}ms、续帧 ${m.frames}，未崩溃`;
    } finally {
      await p.close();
    }
  });

  await check('回归：搜索/详情/右键/一阶 focus/显示 tab 与主题/地图 tab 仍正常', async () => {
    const p = await context.newPage();
    try {
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      const snap = await waitGraphReady(p);
      await p.keyboard.press('Control+K');
      await p.getByRole('combobox').fill('网络');
      await p.locator('section[aria-label="搜索知识"] [role="option"]').first().waitFor({ timeout: 10_000 });
      assert((await p.locator('section[aria-label="搜索知识"] [role="option"]').count()) === 3, '搜索结果数');
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
      assert(t.includes('展开二阶关联'), `一阶后按钮=${t}`);
      await p.mouse.click(40, 900);
      await p.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      await p.locator('button[aria-label="关系图谱设置"]').click();
      for (const tab of ['筛选', '分组', '显示', '力', '主题', '地图']) {
        await p.getByRole('button', { name: tab, exact: true }).waitFor({ timeout: 5_000 });
      }
      await p.getByRole('button', { name: '力', exact: true }).click();
      assert((await p.locator('input[type="range"]').count()) === 4, '力滑块数量');
      await p.locator('button[aria-label="关系图谱设置"]').click();
      return '搜索 3 条、右键 7 项、详情/一阶 focus、六页签 + 4 力滑块正常';
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
  writeFileSync('artifacts/phase7-qa-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
