/**
 * 三档图谱基线：固定 Chrome、1440×900、桌面环境，采集首 tick、布局停止、
 * rAF 帧率、JS 堆增量与 long task。fixtures 自动按固定 seed 生成。
 */
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cwd = process.cwd();
const baseURL = 'http://127.0.0.1:3200';
const passcode = 'graph-perf-passcode';
const fixtures = [
  { name: 'graph-small', nodes: 500, communities: 8, degree: 8, seed: 42, cross: 0.1, isolated: 0.01 },
  { name: 'graph-mid', nodes: 5_000, communities: 20, degree: 6, seed: 7, cross: 0.08, isolated: 0.03 },
  { name: 'graph-large', nodes: 20_000, communities: 40, degree: 5, seed: 11, cross: 0.06, isolated: 0.03 },
];

mkdirSync(join(cwd, 'public/fixtures'), { recursive: true });
mkdirSync(join(cwd, 'artifacts'), { recursive: true });
for (const fixture of fixtures) {
  const out = join(cwd, `public/fixtures/${fixture.name}.json`);
  if (statSync(out, { throwIfNoEntry: false })?.size) continue;
  const generated = spawnSync(
    process.execPath,
    [
      'scripts/gen-graph-data.mjs',
      '-n',
      String(fixture.nodes),
      '-c',
      String(fixture.communities),
      '-d',
      String(fixture.degree),
      '--cross-ratio',
      String(fixture.cross),
      '--isolated-ratio',
      String(fixture.isolated),
      '--out',
      out,
      '--seed',
      String(fixture.seed),
    ],
    { cwd, stdio: 'inherit' },
  );
  if (generated.status !== 0) throw new Error(`生成 ${fixture.name} 失败`);
}

const server = spawn(
  process.execPath,
  [join(cwd, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3200'],
  {
    cwd,
    env: { ...process.env, AUTH_PASSCODE: passcode, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
    windowsHide: true,
  },
);

let stopping = false;
async function stopServer() {
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    channel: process.env.PERF_CHANNEL || 'chrome',
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const context = await browser.newContext({ viewport: { width: 1_440, height: 900 } });
  const login = await context.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL(`${baseURL}/`);
  await login.close();

  const results = [];
  let measuredUserAgent = '';
  for (const fixture of fixtures) {
    const page = await context.newPage();
    let fixtureBytes = null;
    page.on('response', async (response) => {
      if (response.url().endsWith(`/fixtures/${fixture.name}.json`)) {
        fixtureBytes = Number(response.headers()['content-length'] ?? (await response.body().catch(() => Buffer.alloc(0))).length);
      }
    });
    await page.addInitScript(() => {
      window.__kbLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__kbLongTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    });

    await page.goto(`${baseURL}/graph?fixture=${fixture.name}`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => window.__kbGraphFirstTick !== undefined, undefined, { timeout: 90_000 });

    const samples = await page.evaluate(async () => {
      const intervals = [];
      let last = performance.now();
      const start = last;
      while (performance.now() - start < 4_000) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        intervals.push(now - last);
        last = now;
      }
      const sorted = [...intervals].sort((a, b) => a - b);
      return {
        fps: intervals.length / ((performance.now() - start) / 1_000),
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
        firstTickMs: window.__kbGraphFirstTick,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        longTasks: window.__kbLongTasks ?? [],
      };
    });

    await page
      .waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 45_000 })
      .catch(() => {});
    const engineStopMs = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
    measuredUserAgent = await page.evaluate(() => navigator.userAgent);
    results.push({
      fixture: fixture.name,
      nodes: fixture.nodes,
      fixtureBytes,
      firstTickMs: samples.firstTickMs,
      engineStopMs,
      fps: samples.fps,
      p95FrameMs: samples.p95FrameMs,
      heapBytes: samples.heapBytes,
      maxLongTaskMs: samples.longTasks.length ? Math.max(...samples.longTasks) : 0,
    });
    console.log(`${fixture.name}:`, results.at(-1));
    await page.close();
  }

  const report = {
    capturedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      cpu: cpus()[0]?.model ?? 'unknown',
      userAgent: measuredUserAgent,
      viewport: '1440x900',
    },
    results,
  };
  writeFileSync(join(cwd, 'artifacts/graph-baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
}
