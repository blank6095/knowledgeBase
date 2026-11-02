/**
 * 触屏命中区验收：在手机视口下按偏离节点中心 9px 的位置，验证仍能选中该节点。
 * 命中半径为「视觉半径 + 3」（缩放 0.5 时约 2px 屏幕），若无粗指针下限必然点空。
 * 先跑一次 desktop 对照（鼠标视口、同一偏移只作参考，不参与断言）。
 */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { port: { type: 'string', default: '3223' } } });
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = process.env.AUTH_PASSCODE || '';
if (!passcode) throw new Error('缺少 AUTH_PASSCODE');

const server = spawn(process.execPath, [join(process.cwd(), 'node_modules/next/dist/bin/next'), 'start', '--port', values.port], {
  cwd: process.cwd(),
  env: { ...process.env, AUTH_PASSCODE: passcode, NEXT_TELEMETRY_DISABLED: '1' },
  stdio: 'ignore',
  windowsHide: true,
});

const stop = async () => {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((r) => setTimeout(r, 5000))]);
};

let browser;
const out = {};
try {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseURL}/login`, { redirect: 'manual' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/login?next=/graph`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL((url) => new URL(url).pathname === '/graph', { timeout: 30_000 });
  await page.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(900);

  out.coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  const target = await page.evaluate(() => {
    const positions = window.__kbGraphNodePositions ?? [];
    if (!positions.length) return null;
    const inst = window.__kbGraphInstance;
    // 取最接近视口中心、且屏幕位置离边缘足够远的节点
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const scored = positions
      .map((p) => {
        const s = inst.graph2ScreenCoords(p.x, p.y);
        return { ...p, sx: s.x, sy: s.y, d: Math.hypot(s.x - center.x, s.y - center.y) };
      })
      .filter((p) => p.sx > 60 && p.sx < window.innerWidth - 60 && p.sy > 120 && p.sy < window.innerHeight - 120)
      .sort((a, b) => a.d - b.d);
    return scored[0] ?? null;
  });
  if (!target) throw new Error('没有可用于点按验证的节点');

  const box = await page.locator('canvas').first().boundingBox();
  const readPanel = () =>
    page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="知识点详情"]');
      return aside ? (aside.textContent ?? '').slice(0, 80) : null;
    });
  const closePanel = async () => {
    const close = page.getByRole('button', { name: /关闭/ });
    if (await close.count()) await close.first().click().catch(() => {});
    await page.waitForTimeout(300);
  };

  // 对照组：正中点击
  await page.touchscreen.tap(box.x + target.sx, box.y + target.sy);
  await page.waitForTimeout(800);
  const centerPanel = await readPanel();
  out.tapCenter = { panelOpened: centerPanel !== null, head: centerPanel };
  await closePanel();

  // 实验组：偏移 9px（视觉命中半径 ≈2px 之外，粗指针下限 12px 之内）
  await page.touchscreen.tap(box.x + target.sx + 9, box.y + target.sy);
  await page.waitForTimeout(800);
  const panel = await readPanel();
  out.tapOffset9 = { nodeId: target.id, panelOpened: panel !== null, head: panel };
  await closePanel();

  // 负向对照：偏移 40px（远超 12px 下限）不应命中
  await page.touchscreen.tap(box.x + target.sx + 40, box.y + target.sy + 40);
  await page.waitForTimeout(800);
  const farPanel = await readPanel();
  out.tapOffset40 = { panelOpened: farPanel !== null };
  await page.screenshot({ path: 'artifacts/mobile-final/touch-hit.png' });
} finally {
  if (browser) await browser.close();
  await stop();
}

console.log(JSON.stringify(out, null, 2));
