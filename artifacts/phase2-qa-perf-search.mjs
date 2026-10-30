/**
 * 阶段 2 性能补充：8k fixture 下「搜索命中态」渲染帧率（3 轮，各全新页面 4s 采样）。
 * 与 phase1 基线同日对比；只写 artifacts/。
 * 用法：KB_PASSCODE=... node artifacts/phase2-qa-perf-search.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const rounds = Number(process.env.KB_ROUNDS ?? 3);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1_440, height: 900 } });
const rows = [];
try {
  const login = await ctx.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL(`${baseURL}/`);
  await login.close();

  for (let round = 1; round <= rounds; round += 1) {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__kbLongTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__kbLongTasks.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 180_000 });
    await page.waitForFunction(() => window.__kbGraphFirstTick !== undefined, undefined, { timeout: 180_000 });
    // 打开搜索并输入，确保采样期间是「命中态绘制」（匹配全部 8k 节点，含 dim/邻居分支）
    await page.keyboard.press('Control+K');
    await page.locator('section[aria-label="搜索知识"]').waitFor({ state: 'visible', timeout: 10_000 });
    const typingStart = Date.now();
    await page.getByRole('combobox').fill('网络');
    await page.locator('section[aria-label="搜索知识"] [role="option"]').first().waitFor({ timeout: 20_000 });
    const typingMs = Date.now() - typingStart;
    const engineStopBefore = await page.evaluate(() => window.__kbGraphEngineStop ?? null);
    const sample = await page.evaluate(async () => {
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
        longTaskMax: window.__kbLongTasks.length ? Math.max(...window.__kbLongTasks) : 0,
        engineStop: window.__kbGraphEngineStop ?? null,
        optionCount: document.querySelectorAll('section[aria-label="搜索知识"] [role="option"]').length,
        nodeCount: (window.__kbGraphNodePositions ?? []).length,
      };
    });
    rows.push({ round, typingMs, engineStopBefore, ...sample });
    console.log(JSON.stringify(rows.at(-1)));
    await page.close();
  }
} finally {
  await browser.close().catch(() => {});
}
const sortedFps = [...rows].map((r) => r.fps).sort((a, b) => a - b);
const median = sortedFps[Math.floor(sortedFps.length / 2)];
const summary = {
  baseURL,
  fixture: 'graph-large（实际 8000 节点）',
  rounds: rows.length,
  fpsSamples: rows.map((r) => +r.fps.toFixed(3)),
  fpsMedian: +median.toFixed(3),
  fpsMin: +Math.min(...sortedFps).toFixed(3),
  fpsMax: +Math.max(...sortedFps).toFixed(3),
  typingMsSamples: rows.map((r) => r.typingMs),
  p95FrameMs: rows.map((r) => +Number(r.p95FrameMs).toFixed(1)),
  longTaskMax: Math.max(...rows.map((r) => r.longTaskMax)),
  optionCount: rows.map((r) => r.optionCount),
  engineStopStable: rows.every((r) => r.engineStop === rows[0].engineStop),
  rows,
};
console.log('SUMMARY', JSON.stringify(summary));
writeFileSync('artifacts/phase2-qa-perf-search.json', `${JSON.stringify(summary, null, 2)}\n`);
