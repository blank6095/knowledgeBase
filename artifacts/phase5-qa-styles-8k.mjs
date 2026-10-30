/** 8k fixture 四节点风格帧率/内存实测（阶段 3 门禁）。只写 artifacts/。 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const styles = [
  { id: 'orb', label: '光点' },
  { id: 'crystal', label: '晶体' },
  { id: 'wire', label: '线框' },
  { id: 'energy', label: '能量球' },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: 1_440, height: 900 } });
const rows = [];
try {
  const login = await ctx.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL(`${baseURL}/graph`);
  await login.close();

  for (const style of styles) {
    const page = await ctx.newPage();
    await page.addInitScript((id) => {
      localStorage.setItem(
        'kb.graph.preferences.v1',
        JSON.stringify({ version: 1, environment: 'deep-space', nodeStyle: id, glow: 1, background: 1 }),
      );
    }, style.id);
    await page.addInitScript(() => {
      window.__kbLongTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__kbLongTasks.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(`${baseURL}/graph?fixture=graph-large`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 180_000 });
    await page.waitForFunction(() => window.__kbGraphFirstTick !== undefined, undefined, { timeout: 180_000 });
    const applied = await page.evaluate(() => ({
      html: document.documentElement.dataset.graphEnv,
      style: JSON.parse(localStorage.getItem('kb.graph.preferences.v1') ?? '{}').nodeStyle,
    }));
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
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        maxLongTaskMs: window.__kbLongTasks?.length ? Math.max(...window.__kbLongTasks) : 0,
        nodes: (window.__kbGraphNodePositions ?? []).length,
      };
    });
    rows.push({ style: style.id, label: style.label, applied, ...sample });
    console.log(JSON.stringify(rows.at(-1)));
    await page.close();
  }
} finally {
  await browser.close().catch(() => {});
}
const baseFps = rows[0]?.fps ?? 0;
const baseHeap = rows[0]?.heapBytes ?? 0;
const summary = {
  baseURL,
  capturedAt: new Date().toISOString(),
  fixture: 'graph-large（实际 8000 节点）',
  rows: rows.map((r) => ({
    ...r,
    fpsDeltaPct: baseFps ? +(((r.fps - baseFps) / baseFps) * 100).toFixed(1) : null,
    heapDeltaPct: baseHeap && r.heapBytes ? +(((r.heapBytes - baseHeap) / baseHeap) * 100).toFixed(1) : null,
  })),
  redThreshold: '任一风格相对光点 fps 劣化 >15% 判红',
  reds: rows
    .filter((r) => baseFps && (baseFps - r.fps) / baseFps > 0.15)
    .map((r) => `${r.style} fps ${r.fps.toFixed(2)}（${(((r.fps - baseFps) / baseFps) * 100).toFixed(1)}%）`),
};
console.log('SUMMARY', JSON.stringify(summary));
writeFileSync('artifacts/phase5-qa-styles-8k.json', `${JSON.stringify(summary, null, 2)}\n`);
