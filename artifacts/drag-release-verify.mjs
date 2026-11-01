/**
 * 拖拽释放手感验收（惯性投射 / 停稳闸）。
 *
 * 对比两种真实手势，读取页内埋点 `__kbDragRelease`（本次释放注入的初速度）并测量
 * 节点从松手点到最终静止点的滑行距离：
 *   A. flick：快速拖动后立刻松手 → 应注入非零初速度、有可见滑行（约 20–60px）；
 *   B. pause：拖到目标后停住 160ms 再松手 → 初速度必须为 0、滑行接近 0。
 *
 * 旧实现的两个问题在这里都能复现：`onNodeDragEnd` 先清空采样再读速度（惯性恒为 0），
 * 以及没有停稳闸（停顿后松手仍按停顿前的速度飞出）。
 *
 * 用法：node --env-file=.env.local artifacts/drag-release-verify.mjs [--fixture graph-small] [--port 3217]
 */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    fixture: { type: 'string', default: 'graph-small' },
    port: { type: 'string', default: '3217' },
    passcode: { type: 'string', default: '' },
  },
});

const cwd = process.cwd();
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = values.passcode || process.env.AUTH_PASSCODE || '';
if (!passcode) throw new Error('缺少 AUTH_PASSCODE');

const server = spawn(
  process.execPath,
  [join(cwd, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', values.port],
  {
    cwd,
    env: { ...process.env, AUTH_PASSCODE: passcode, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'ignore',
    windowsHide: true,
  },
);

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((r) => setTimeout(r, 5_000))]);
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
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('等待 Next 启动超时');
}

const HELPERS = `
  window.__kbCandidates = () => {
    const positions = window.__kbGraphNodePositions ?? [];
    if (positions.length === 0) return [];
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    return [...positions]
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
      .slice(0, 24);
  };
  window.__kbCenterOn = (x, y) => {
    window.__kbGraphInstance.centerAt(x, y, 0);
    window.__kbGraphInstance.zoom(2.2, 0);
  };
  window.__kbScreenOfPos = (x, y) => window.__kbGraphInstance.graph2ScreenCoords(x, y);
  window.__kbToGraph = (x, y) => window.__kbGraphInstance.screen2GraphCoords(x, y);
  window.__kbArmStop = () => {
    window.__kbStopCount = 0;
    window.addEventListener('kb:graph-engine-stop', () => { window.__kbStopCount += 1; });
  };
`;

/** 抓住一个节点（d3-drag 命中后 canvas 会加 grabbable 类） */
async function grabNode(page, box, candidates) {
  for (const node of candidates) {
    await page.evaluate((c) => window.__kbCenterOn(c.x, c.y), node);
    await page.waitForTimeout(220);
    const pt = await page.evaluate((c) => window.__kbScreenOfPos(c.x, c.y), node);
    if (!pt || pt.x < 80 || pt.x > 1360 || pt.y < 80 || pt.y > 820) continue;
    const sx = box.x + pt.x;
    const sy = box.y + pt.y;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const grabbable = await page.evaluate(
      () => document.querySelector('canvas')?.classList.contains('grabbable') ?? false,
    );
    if (grabbable) return { node, sx, sy };
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  return null;
}

/** 一次手势：快拖 8 步（约 1250px/s），可选停顿后松手；返回释放决策与滑行距离 */
async function runScenario(page, box, candidates, holdMs) {
  const grabbed = await grabNode(page, box, candidates);
  if (!grabbed) return { error: '抓取失败' };
  const { node, sx, sy } = grabbed;

  const steps = 8;
  let lx = sx;
  let ly = sy;
  for (let i = 1; i <= steps; i += 1) {
    lx = sx + i * 18;
    ly = sy + i * 8;
    await page.mouse.move(lx, ly, { steps: 1 });
    await page.waitForTimeout(16);
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  const releaseAt = await page.evaluate((p) => window.__kbToGraph(p.x, p.y), { x: lx - box.x, y: ly - box.y });

  await page.evaluate(() => window.__kbArmStop());
  await page.mouse.up();
  await page.waitForTimeout(40);
  const decision = await page.evaluate(() => window.__kbDragRelease ?? null);
  await page.waitForFunction(() => window.__kbStopCount > 0, undefined, { timeout: 20_000 }).catch(() => {});
  const positions = await page.evaluate(() => window.__kbGraphNodePositions ?? []);
  const final = positions.find((p) => p.id === node.id);
  const glide = final ? Math.hypot(final.x - releaseAt.x, final.y - releaseAt.y) : null;

  return {
    nodeId: node.id,
    speed: decision ? Number(Math.hypot(decision.vx, decision.vy).toFixed(2)) : null,
    vx: decision ? Number(decision.vx.toFixed(2)) : null,
    vy: decision ? Number(decision.vy.toFixed(2)) : null,
    scale: decision ? Number(decision.scale.toFixed(2)) : null,
    glidePx: glide === null ? null : Number(glide.toFixed(1)),
  };
}

let browser;
const rows = [];
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

  const page = await context.newPage();
  await page.goto(`${baseURL}/graph?fixture=${values.fixture}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 90_000 });
  await page.waitForTimeout(900);
  await page.evaluate(HELPERS);

  const box = await canvas.boundingBox();
  for (const [label, holdMs] of [
    ['flick（快拖即松）', 0],
    ['pause（停 160ms 再松）', 160],
  ]) {
    const candidates = await page.evaluate(() => window.__kbCandidates());
    const result = await runScenario(page, box, candidates, holdMs);
    rows.push({ scenario: label, ...result });
    await page.waitForTimeout(500);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}

console.log(JSON.stringify({ fixture: values.fixture, rows }, null, 2));
