/**
 * 移动端屏幕适配审计（知识宇宙页）。
 *
 * 在多个手机视口（含横屏）下打开 /graph?fixture=graph-small，量取：
 * - 文档横向溢出（scrollWidth - innerWidth）；
 * - 超出视口的 fixed/absolute 浮层（布局错位、元素溢出）；
 * - 顶栏 / 操作簇 / 底部导航 / 图例的包围盒与触控目标尺寸；
 * - 打开设置面板后的面板包围盒（是否被底部导航遮挡）；
 * - 各视口截图。
 *
 * 用法：node --env-file=.env.local artifacts/mobile-audit.mjs [--port 3220]
 */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3220' },
    passcode: { type: 'string', default: '' },
    tag: { type: 'string', default: 'before' },
  },
});

const cwd = process.cwd();
const baseURL = `http://127.0.0.1:${values.port}`;
const passcode = values.passcode || process.env.AUTH_PASSCODE || '';
if (!passcode) throw new Error('缺少 AUTH_PASSCODE');
const outDir = join(cwd, 'artifacts', `mobile-${values.tag}`);
mkdirSync(outDir, { recursive: true });

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

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, mobile: true },
  { name: '360x640', width: 360, height: 640, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '412x915', width: 412, height: 915, mobile: true },
  { name: '768x1024-tablet', width: 768, height: 1024, mobile: true },
  { name: '844x390-landscape', width: 844, height: 390, mobile: true },
  { name: '1440x900-desktop', width: 1440, height: 900, mobile: false },
];

const MEASURE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const cls = (el) => (typeof el.className === 'string' ? el.className : '').slice(0, 90);
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) {
      offenders.push({ tag: el.tagName, cls: cls(el), rect: rect(el) });
      if (offenders.length >= 15) break;
    }
  }
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  const navButtons = nav ? [...nav.querySelectorAll('a,button')].map((b) => rect(b)) : [];
  const visibleNav = navButtons.filter((r) => r.w > 1);
  let navOverlap = 0;
  for (let i = 1; i < visibleNav.length; i += 1) {
    if (visibleNav[i].x < visibleNav[i - 1].right - 0.5) navOverlap += 1;
  }
  const navRect = rect(nav);
  const header = document.querySelector('header[aria-label="知识宇宙顶栏"]');
  const legend = document.querySelector('[aria-label="记忆度图例"], [aria-label="展开记忆度图例"]');
  const actionButtons = [...document.querySelectorAll('button')]
    .filter((b) => /学习地图|联系两概念|关系图谱设置/.test(b.getAttribute('aria-label') || b.textContent || ''))
    .map((b) => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 12), rect: rect(b) }));

  const positions = window.__kbGraphNodePositions ?? [];
  const bbox = positions.length
    ? positions.reduce(
        (acc, p) => ({
          minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
          minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      )
    : null;
  const zoom = window.__kbGraphInstance?.zoom?.();

  return {
    viewport: { w: vw, h: vh },
    docScrollWidth: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - vw,
    canvas: rect(document.querySelector('canvas')),
    nav: navRect,
    navItemCount: navButtons.length,
    navItems: navButtons,
    navOverlap,
    navLastRight: visibleNav.length ? Math.max(...visibleNav.map((r) => r.right)) : null,
    navInnerRight: navRect ? navRect.right - 6 : null,
    navItemMin: navButtons.length
      ? Math.min(...navButtons.map((r) => Math.min(r.w, r.h)))
      : null,
    navItemsOverflow: nav
      ? Math.max(0, Math.round(nav.scrollWidth - nav.clientWidth))
      : null,
    header: rect(header),
    legend: rect(legend),
    actionButtons,
    graphBbox: bbox
      ? { w: Math.round(bbox.maxX - bbox.minX), h: Math.round(bbox.maxY - bbox.minY) }
      : null,
    zoom: typeof zoom === 'number' ? Number(zoom.toFixed(3)) : null,
    offenders,
  };
};

let browser;
const report = [];
try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.PERF_CHANNEL || 'chrome', headless: true });

  // 登录一次，复用 storageState
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
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => window.__kbGraphEngineStop !== undefined, undefined, { timeout: 90_000 });
    await page.waitForTimeout(900);

    const base = await page.evaluate(MEASURE);
    await page.screenshot({ path: join(outDir, `${vp.name}.png`) });

    // 打开设置面板，测它是否被底部导航遮挡
    let panel = null;
    const gear = page.getByRole('button', { name: '关系图谱设置' });
    if (await gear.count()) {
      await gear.first().click();
      await page.waitForTimeout(250);
      // 切到内容最长的「地图」页，验证面板最大高度下是否被底部导航遮挡
      const mapTab = page.getByRole('button', { name: '地图', exact: true });
      if (await mapTab.count()) {
        await mapTab.first().click();
        await page.waitForTimeout(250);
      }
      panel = await page.evaluate(() => {
        const p = [...document.querySelectorAll('div')].find((d) => {
          const cs = getComputedStyle(d);
          const r = d.getBoundingClientRect();
          return cs.position === 'absolute' && typeof d.className === 'string' && d.className.includes('top-32') && r.width > 200;
        });
        if (!p) return null;
        const r = p.getBoundingClientRect();
        const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
        const nr = nav?.getBoundingClientRect();
        return {
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
          navTop: nr ? Math.round(nr.top) : null,
          overlapWithNav: nr ? Math.max(0, Math.round(r.bottom - nr.top)) : null,
          scrollable: p.scrollHeight > p.clientHeight + 1,
        };
      });
      await page.screenshot({ path: join(outDir, `${vp.name}-panel.png`) });
      await gear.first().click();
      await page.waitForTimeout(250);
    }

    // 适应视图：验证全图可回到视口内（并截图判断缩放后的可读性）
    let fitted = null;
    const fitBtn = page.getByRole('button', { name: '适应视图' });
    if (await fitBtn.count()) {
      await fitBtn.first().click();
      await page.waitForTimeout(800);
      fitted = await page.evaluate(() => {
        const z = window.__kbGraphInstance?.zoom?.();
        return { zoom: typeof z === 'number' ? Number(z.toFixed(3)) : null };
      });
      await page.screenshot({ path: join(outDir, `${vp.name}-fit.png`) });
    }

    report.push({ viewport: vp.name, ...base, panel, fitted });
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
