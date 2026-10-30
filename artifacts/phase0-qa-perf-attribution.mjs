/**
 * 归因实验（不改 src）：graph-mid 下 deep-space（新背景纹理层）vs minimal（纯色）
 * 的 FPS / p95 差异，判断阶段 0 新增背景层是否吃掉渲染性能。
 * 每个变体用全新页面测 4s（与 scripts/measure-graph.mjs 同口径），交替两轮消掉漂移。
 */
import { chromium } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const fixture = process.argv[2] || 'graph-mid';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 900 } });
const rows = [];
try {
  const login = await context.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL(`${baseURL}/`);
  await login.close();

  for (const round of [1, 2]) {
    for (const env of ['deep-space', 'minimal']) {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__kbLongTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__kbLongTasks.push(e.duration);
        }).observe({ type: 'longtask', buffered: true });
      });
      await page.goto(`${baseURL}/graph?fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
      await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 120_000 });
      await page.waitForFunction(() => window.__kbGraphFirstTick !== undefined, undefined, { timeout: 120_000 });
      if (env === 'minimal') {
        await page.evaluate(() => {
          document.querySelector('.graph-background').dataset.graphEnv = 'minimal';
        });
      }
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
          firstTickMs: window.__kbGraphFirstTick,
          longTaskMax: window.__kbLongTasks.length ? Math.max(...window.__kbLongTasks) : 0,
          env: document.querySelector('.graph-background').dataset.graphEnv,
        };
      });
      rows.push({ fixture, round, env, ...sample });
      console.log(JSON.stringify(rows.at(-1)));
      await page.close();
    }
  }
} finally {
  await browser.close().catch(() => {});
}
const avg = (env) => {
  const list = rows.filter((r) => r.env === env);
  return {
    env,
    samples: list.length,
    fps: +(list.reduce((s, r) => s + r.fps, 0) / list.length).toFixed(2),
    p95FrameMs: +(list.reduce((s, r) => s + r.p95FrameMs, 0) / list.length).toFixed(1),
    longTaskMax: Math.max(...list.map((r) => r.longTaskMax)),
  };
};
console.log('SUMMARY', JSON.stringify({ deep: avg('deep-space'), minimal: avg('minimal') }));
