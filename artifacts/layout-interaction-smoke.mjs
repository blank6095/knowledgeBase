/**
 * 星群布局交互冒烟（docs/graph-star-cluster-layout.md §4.2）。
 *
 * 覆盖：缩放、平移、设置面板开关、力面板「恢复星群默认」重热后回弹检查、暂停/继续。
 * 输出 JSON 结果；任何 pageerror 视为失败。
 *
 * 用法：node --env-file=.env.local artifacts/layout-interaction-smoke.mjs
 */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3100' },
    fixture: { type: 'string', default: 'graph-small' },
    passcode: { type: 'string', default: '' },
  },
});

const BASE = values.base;
const PASSCODE = values.passcode || process.env.AUTH_PASSCODE || '';
const RADIAL_BOUND_K = 1.6;
const bound = (n) => RADIAL_BOUND_K * 30 * Math.sqrt(n);

const readMaxR = (page) =>
  page.evaluate(() => {
    const positions = window.__kbGraphNodePositions ?? [];
    const n = positions.length;
    if (n === 0) return { n: 0, maxR: 0 };
    const mx = positions.reduce((s, p) => s + p.x, 0) / n;
    const my = positions.reduce((s, p) => s + p.y, 0) / n;
    const maxR = Math.max(...positions.map((p) => Math.hypot(p.x - mx, p.y - my)));
    return { n, maxR };
  });

const waitStop = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 20000);
        window.addEventListener(
          'kb:graph-engine-stop',
          () => {
            clearTimeout(timer);
            resolve('stop');
          },
          { once: true },
        );
      }),
  );

const run = async () => {
  if (!PASSCODE) throw new Error('缺少 AUTH_PASSCODE');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const token = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');
  await context.addCookies([{ name: 'kb_session', value: token, url: BASE, httpOnly: true }]);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/graph?fixture=${values.fixture}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__kbGraphNodePositions), null, { timeout: 60000 });
  const before = await readMaxR(page);

  // 1) 缩放：滚轮放大两档，确认无异常
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(250);

  // 2) 平移：拖拽画布
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(560, 380, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // 3) 设置面板 → 力 tab → 恢复星群默认（触发重热）
  await page.getByRole('button', { name: '关系图谱设置' }).click();
  await page.getByRole('button', { name: '力', exact: true }).click();
  const reset = page.getByRole('button', { name: '恢复星群默认' });
  const resetVisible = await reset.isVisible();
  await reset.click();
  const reheated = await waitStop(page);
  const after = await readMaxR(page);

  // 4) 暂停 / 继续（位于「显示」tab）
  await page.getByRole('button', { name: '显示', exact: true }).click();
  const pause = page.getByRole('button', { name: /暂停动画|继续动画/ });
  const pauseVisible = await pause.isVisible();
  if (pauseVisible) {
    await pause.click();
    await page.waitForTimeout(150);
    await pause.click();
  }

  await page.screenshot({ path: `artifacts/layout-smoke-${values.fixture}.png` });

  const limit = bound(after.n) * 1.2;
  const result = {
    fixture: values.fixture,
    before: { n: before.n, maxR: Number(before.maxR.toFixed(1)) },
    after: { n: after.n, maxR: Number(after.maxR.toFixed(1)), bound: Number(bound(after.n).toFixed(1)) },
    reheated,
    bounceOk: after.maxR <= limit,
    resetVisible,
    pauseVisible,
    pageErrors: errors,
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (errors.length > 0 || !result.bounceOk || !resetVisible) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
