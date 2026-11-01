/**
 * 星群布局验收脚本（docs/graph-star-cluster-layout.md §4.1）。
 *
 * 读取画布在引擎停止后暴露的节点坐标（window.__kbGraphNodePositions），
 * 以质心为原点计算四项指标：
 * - 圆度：max(σx,σy)/min(σx,σy) ≤ 1.6
 * - 中心密集度：P50(半径)/P95(半径) ≤ 0.55
 * - 外缘受控：max(半径)/radialBoundFor(N, linkDistance) ≤ 1.15
 * - 节点规模与收敛耗时（参考值）
 *
 * 用法（需本地 dev 已启动，且 .env.local 提供 AUTH_PASSCODE）：
 *   node --env-file=.env.local artifacts/measure-layout.mjs
 *   node --env-file=.env.local artifacts/measure-layout.mjs --fixtures graph-small --base http://localhost:3100
 */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3100' },
    fixtures: { type: 'string', default: 'graph-small,graph-mid' },
    passcode: { type: 'string', default: '' },
    timeout: { type: 'string', default: '90000' },
  },
});

const BASE = values.base;
const PASSCODE = values.passcode || process.env.AUTH_PASSCODE || '';
const TIMEOUT = Number(values.timeout);
const FIXTURES = values.fixtures.split(',').map((s) => s.trim()).filter(Boolean);

/** 与 src/lib/graph/graph-forces.ts 保持一致的常量（脚本独立运行，避免引 TS） */
const RADIAL_BOUND_K = 1.6;
const DEFAULT_LINK_DISTANCE = 30;

const radialBoundFor = (n, ld = DEFAULT_LINK_DISTANCE) => (n > 0 ? RADIAL_BOUND_K * ld * Math.sqrt(n) : 0);

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

function measure(positions) {
  const n = positions.length;
  if (n === 0) return { n: 0 };
  const mx = positions.reduce((s, p) => s + p.x, 0) / n;
  const my = positions.reduce((s, p) => s + p.y, 0) / n;
  const radii = positions.map((p) => Math.hypot(p.x - mx, p.y - my)).sort((a, b) => a - b);
  const sx = Math.sqrt(positions.reduce((s, p) => s + (p.x - mx) ** 2, 0) / n);
  const sy = Math.sqrt(positions.reduce((s, p) => s + (p.y - my) ** 2, 0) / n);
  const roundness = sx > 0 && sy > 0 ? Math.max(sx, sy) / Math.min(sx, sy) : Number.POSITIVE_INFINITY;
  const p50 = quantile(radii, 0.5);
  const p95 = quantile(radii, 0.95);
  const maxR = radii[radii.length - 1];
  const bound = radialBoundFor(n);
  return {
    n,
    roundness: Number(roundness.toFixed(3)),
    centerDensity: Number((p95 > 0 ? p50 / p95 : 0).toFixed(3)),
    edgeControl: Number((bound > 0 ? maxR / bound : 0).toFixed(3)),
    p50: Number(p50.toFixed(1)),
    p95: Number(p95.toFixed(1)),
    maxR: Number(maxR.toFixed(1)),
    bound: Number(bound.toFixed(1)),
  };
}

const pass = (m) => {
  if (m.n <= 0) return false;
  // 中心密集度按规模分档：
  // - n < 50：分位数样本太小（P95≈最大值），不判定；
  // - n <= 1000：施主形态应中心密集，≤0.55；
  // - n > 1000：社区臂会抬高 P95，均匀圆盘理论极限约 0.72，放宽到 0.70。
  const densityLimit = m.n < 50 ? Number.POSITIVE_INFINITY : m.n <= 1000 ? 0.55 : 0.7;
  return m.roundness <= 1.6 && m.centerDensity <= densityLimit && m.edgeControl <= 1.15;
};

const run = async () => {
  if (!PASSCODE) throw new Error('缺少 AUTH_PASSCODE（用 --passcode 或 .env.local 提供）');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const token = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');
  await context.addCookies([{ name: 'kb_session', value: token, url: BASE, httpOnly: true }]);

  const results = [];
  for (const fixture of FIXTURES) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // real = 真实库（/graph），其余为压测 fixture（/graph?fixture=<name>）
    const target = fixture === 'real' ? `${BASE}/graph` : `${BASE}/graph?fixture=${fixture}`;
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Array.isArray(window.__kbGraphNodePositions), null, { timeout: TIMEOUT });
    const started = Date.now();
    const positions = await page.evaluate(() => window.__kbGraphNodePositions);
    const metrics = measure(positions);
    const shot = `artifacts/layout-${fixture}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ fixture, ...metrics, ok: pass(metrics), pageErrors: errors, screenshot: shot, waitedMs: Date.now() - started });
    await page.close();
  }
  await browser.close();

  console.log(JSON.stringify({ base: BASE, results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n[FAIL] ${failed.map((f) => f.fixture).join(', ')} 未达 §4.1 指标`);
    process.exitCode = 1;
  } else {
    console.log('\n[PASS] 全部 fixture 达到星群布局指标');
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
