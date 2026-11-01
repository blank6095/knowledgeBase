/**
 * 拖拽流畅度验收脚本（知识宇宙拖拽优化）。
 *
 * 对 /graph?fixture=<name> 执行合成拖拽（Playwright mouse API），采样：
 * - 拖拽期间 rAF 帧率 / 平均帧耗时 / p95 帧耗时（只统计确认抓到节点后的窗口）；
 * - 图谱包围盒位移（getGraphBbox，验证拖拽确实改动了布局）；
 * - 释放后布局再次收敛耗时（kb:graph-engine-stop 事件计数）；
 * - 拖拽前 / 释放收敛后截图（验证星群形态在拖拽扰动后回归）。
 *
 * 注意：引擎停止后 autoPauseRedraw 会跳过重绘，抓取失败时拖拽只是空移动，
 * 测出的帧率没有意义。React ref 只暴露 12 个方法（无 graphData），因此：
 * - 候选点取自引擎停止时的 __kbGraphNodePositions 快照；
 * - 抓取校验用「节点邻域截图 clip 像素 diff」——抓到节点时该区域必然重绘变化。
 *
 * 用法（.env.local 需提供 AUTH_PASSCODE）：
 *   node --env-file=.env.local artifacts/drag-verify.mjs
 *   node --env-file=.env.local artifacts/drag-verify.mjs --fixtures graph-small --port 3210
 */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    fixtures: { type: 'string', default: 'graph-small,graph-mid' },
    port: { type: 'string', default: '3210' },
    passcode: { type: 'string', default: '' },
    'keep-server': { type: 'boolean', default: false },
  },
});

const cwd = process.cwd();
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = values.passcode || process.env.AUTH_PASSCODE || '';
const fixtures = values.fixtures.split(',').map((s) => s.trim()).filter(Boolean);
if (!passcode) throw new Error('缺少 AUTH_PASSCODE（用 --env-file=.env.local 或 --passcode 提供）');

// ---- dev 服务器（复用 measure-graph.mjs 的启动/清理模式） ----
const server = spawn(
  process.execPath,
  [join(cwd, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', values.port],
  { cwd, env: { ...process.env, AUTH_PASSCODE: passcode, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit', windowsHide: true },
);

let stopping = false;
async function stopServer() {
  if (values['keep-server']) return;
  if (stopping || server.exitCode !== null) return;
  stopping = true;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next 启动失败，退出码 ${server.exitCode}`);
    try {
      await fetch(`${baseURL}/login`, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('等待 Next 启动超时');
}

// ---- 页内辅助（只用 ref 暴露的 12 个方法 + 验收埋点） ----
const PAGE_HELPERS = `
  window.__kbCandidates = () => {
    const positions = window.__kbGraphNodePositions ?? [];
    if (positions.length === 0) return [];
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    return [...positions]
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .slice(0, 24)
      .map((p) => ({ id: p.id, x: p.x, y: p.y }));
  };
  window.__kbCenterOn = (x, y) => {
    const inst = window.__kbGraphInstance;
    inst.centerAt(x, y, 0);
    inst.zoom(2.2, 0);
  };
  window.__kbScreenOfPos = (x, y) => window.__kbGraphInstance.graph2ScreenCoords(x, y);
  window.__kbBbox = () => {
    const inst = window.__kbGraphInstance;
    return inst.getGraphBbox ? inst.getGraphBbox() : null;
  };
  window.__kbArmStopCounter = () => {
    window.__kbStopCount = 0;
    window.addEventListener('kb:graph-engine-stop', () => { window.__kbStopCount += 1; });
  };
`;

// ---- 页内 rAF 采样器：记录每帧间隔 ----
const START_SAMPLER = `
  window.__dragFrames = [];
  let last = performance.now();
  (function tick() {
    const now = performance.now();
    window.__dragFrames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  })();
`;

const summarize = (frames) => {
  if (frames.length === 0) return { count: 0, fps: 0, avgMs: null, p95Ms: null };
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    count: frames.length,
    fps: Number((1000 / (frames.reduce((s, v) => s + v, 0) / frames.length)).toFixed(1)),
    avgMs: Number((frames.reduce((s, v) => s + v, 0) / frames.length).toFixed(1)),
    p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]).toFixed(1)),
  };
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.PERF_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1_440, height: 900 } });

  const login = await context.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 60_000 });
  await login.close();

  const results = [];
  for (const fixture of fixtures) {
    const page = await context.newPage();
    await page.goto(`${baseURL}/graph?fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 90_000 });
    await page.waitForTimeout(900); // 等首次 zoomToFit 动画结束，坐标才稳定
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(() => window.__kbArmStopCounter());

    const box = await canvas.boundingBox();
    const candidates = await page.evaluate(() => window.__kbCandidates());
    if (candidates.length === 0) throw new Error(`${fixture}: 无可拖候选节点（__kbGraphNodePositions 为空）`);

    // 逐候选尝试：放大到节点处 → 按下 → 用 canvas 的 grabbable 类判定真实抓取
    // （d3-drag 仅在 subject 命中节点时进入 start 处理器并加 grabbable 类；
    //  像素 diff 会被 hover/tooltip 重绘造成假阳性，不可靠）
    let grabbed = null;
    let startX = 0;
    let startY = 0;
    for (const candidate of candidates) {
      await page.evaluate((c) => window.__kbCenterOn(c.x, c.y), candidate);
      await page.waitForTimeout(150);
      const pt = await page.evaluate((c) => window.__kbScreenOfPos(c.x, c.y), candidate);
      if (!pt || pt.x < 80 || pt.x > 1360 || pt.y < 80 || pt.y > 820) continue;
      startX = box.x + pt.x;
      startY = box.y + pt.y;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      const state = await page.evaluate(() => ({
        grabbable: document.querySelector('canvas')?.classList.contains('grabbable') ?? false,
      }));
      if (state.grabbable) {
        grabbed = candidate;
        break;
      }
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    if (!grabbed) throw new Error(`${fixture}: 所有候选点都抓取失败（命中区域过小或遮挡）`);

    // ---- 正式拖拽：Lissajous 平滑曲线，约 1.1s、行程约 480px ----
    const bboxBefore = await page.evaluate(() => window.__kbBbox());
    await page.evaluate(START_SAMPLER);
    const steps = 32;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const angle = Math.PI * 1.5 * t;
      const x = startX + 5 * 6 + Math.sin(angle) * 240 * t;
      const y = startY + 5 * 4 + Math.sin(2 * angle) * 110 * t;
      await page.mouse.move(x, y, { steps: 1 });
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(150); // 采样尾巴

    // ---- 释放后等待再次收敛（stop 事件计数） ----
    const stopTsBefore = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
    const settleStart = Date.now();
    await page.waitForFunction(() => window.__kbStopCount > 0, undefined, { timeout: 25_000 }).catch(() => {});
    const settleMs = Date.now() - settleStart;
    const stopInfo = await page.evaluate(() => ({
      stopCount: window.__kbStopCount ?? 0,
      stopTs: window.__kbGraphEngineStop ?? null,
      canvasClass: document.querySelector('canvas')?.className ?? '',
    }));
    const bboxAfter = await page.evaluate(() => window.__kbBbox());
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(cwd, `artifacts/drag-${fixture}-after.png`) });

    const frames = await page.evaluate(() => {
      const list = window.__dragFrames ?? [];
      // 只取最近 1.6s（拖拽 + 释放尾巴）内的帧
      let acc = 0;
      const windowFrames = [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        acc += list[i];
        if (acc > 1_600) break;
        windowFrames.push(list[i]);
      }
      return windowFrames;
    });

    const bboxShift = bboxBefore && bboxAfter
      ? Number(Math.hypot(bboxAfter.x - bboxBefore.x, bboxAfter.y - bboxBefore.y).toFixed(1))
      : null;

    const row = {
      fixture,
      grabbedId: grabbed.id,
      dragStats: summarize(frames),
      bboxShift,
      settleMs,
      settleTimedOut: settleMs >= 24_000,
      stopCountAfter: stopInfo.stopCount,
      stopTsAdvanced: stopInfo.stopTs !== null && stopInfo.stopTs !== stopTsBefore,
      canvasClassAfter: stopInfo.canvasClass,
    };
    results.push(row);
    console.log(`${fixture}:`, JSON.stringify(row));
    await page.close();
  }

  const report = {
    capturedAt: new Date().toISOString(),
    environment: { platform: process.platform, cpu: cpus()[0]?.model ?? 'unknown', viewport: '1440x900' },
    results,
  };
  writeFileSync(join(cwd, 'artifacts/drag-verify.json'), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
}
