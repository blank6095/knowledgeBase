/**
 * /graph 移动端 UI 重构验收（375–768px + 桌面回归）。
 *
 * 逐视口验证并截图：
 * - 基准页：Logo 是否在 <md 隐藏、搜索是否占满、动作簇是否收起为「更多操作」、底部条入口数、图例尺寸；
 * - 移动端：打开「更多操作」下拉、底部「更多导航」抽屉、展开图例，各截一张；
 * - 桌面：三个动作按钮 + 完整左栏仍在（回归）。
 *
 * 用法：node --env-file=.env.local artifacts/graph-ui-verify.mjs [--port 3226]
 */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '3226' }, mode: { type: 'string', default: 'dev' } },
});
const cwd = process.cwd();
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = process.env.AUTH_PASSCODE || '';
if (!passcode) throw new Error('缺少 AUTH_PASSCODE');
const outDir = join(cwd, 'artifacts', 'graph-ui');
mkdirSync(outDir, { recursive: true });

const server = spawn(
  process.execPath,
  [
    join(cwd, 'node_modules/next/dist/bin/next'),
    values.mode === 'start' ? 'start' : 'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    values.port,
  ],
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

const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '768x1024-tablet', width: 768, height: 1024, mobile: true },
  { name: '1440x900-desktop', width: 1440, height: 900, mobile: false },
];

const MEASURE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      right: Math.round(b.right), bottom: Math.round(b.bottom) };
  };
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  const navItems = nav ? [...nav.querySelectorAll('a,button')].map(r).filter((b) => b.w > 1) : [];
  const brand = [...document.querySelectorAll('header span')].find((s) => s.textContent?.trim() === '知识宇宙');
  const search = document.querySelector('header button[aria-label^="搜索知识"]');
  const legend = document.querySelector('[aria-label="展开记忆度图例"]');
  const more = document.querySelector('[aria-label="更多操作"]');
  return {
    viewport: { w: vw, h: vh },
    overflowX: document.documentElement.scrollWidth - vw,
    zoom: Number((window.__kbGraphInstance?.zoom?.() ?? 0).toFixed(3)),
    logoVisible: brand ? brand.getBoundingClientRect().width > 0 && getComputedStyle(brand).display !== 'none' : false,
    search: r(search),
    desktopActions: [...document.querySelectorAll('button')].filter(
      (b) => /学习地图|联系两概念/.test(b.textContent || '') && b.getBoundingClientRect().width > 1,
    ).length,
    hasMoreActions: more ? more.getBoundingClientRect().width > 0 : false,
    navItemCount: navItems.length,
    navHeight: r(nav)?.h ?? null,
    navBottomGap: r(nav) ? vh - r(nav).bottom : null,
    legend: r(legend),
  };
};

let browser;
const report = [];
try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.PERF_CHANNEL || 'chrome', headless: true });

  const boot = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const login = await boot.newPage();
  await login.goto(`${baseURL}/login`);
  await login.getByPlaceholder('访问口令').fill(passcode);
  await login.getByRole('button', { name: '进入' }).click();
  await login.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 60_000 });
  const storageState = await boot.storageState();
  await boot.close();

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      deviceScaleFactor: 2,
      storageState,
    });
    const page = await context.newPage();
    await page.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 90_000 });
    await page.waitForTimeout(1_200); // 等首屏 fit 动画结束

    const row = { viewport: vp.name, ...(await page.evaluate(MEASURE)) };
    await page.screenshot({ path: join(outDir, `${vp.name}.png`) });

    if (vp.mobile && vp.width < 768) {
      // 更多操作下拉
      await page.getByRole('button', { name: '更多操作' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(outDir, `${vp.name}-actions.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);

      // 更多导航抽屉
      await page.getByRole('button', { name: '更多导航' }).click();
      await page.waitForTimeout(250);
      row.sheetVisible = await page.getByRole('dialog', { name: '更多导航' }).isVisible();
      await page.screenshot({ path: join(outDir, `${vp.name}-sheet.png`) });
      await page.getByRole('button', { name: '关闭更多导航' }).click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(200);

      // 图例展开
      await page.getByRole('button', { name: '展开记忆度图例' }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(outDir, `${vp.name}-legend.png`) });
      await page.getByRole('button', { name: '收起记忆度图例' }).click().catch(() => {});

      // 适度缩放：验证标签渲染（移动端阈值已下调到 0.66）
      await page.evaluate(() => window.__kbGraphInstance.zoom(1.15, 0));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `${vp.name}-labels.png`) });
    }

    report.push(row);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
