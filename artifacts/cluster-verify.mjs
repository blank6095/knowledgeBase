/**
 * 聚合布局视觉验收：首帧、收敛后、聚焦态三张截图 + 聚焦面板是否打开。
 * 用法：node --env-file=.env.local artifacts/cluster-verify.mjs --target graph-small
 *      node --env-file=.env.local artifacts/cluster-verify.mjs --target real
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3100' },
    target: { type: 'string', default: 'graph-small' },
    passcode: { type: 'string', default: '' },
  },
});

const BASE = values.base;
const PASSCODE = values.passcode || process.env.AUTH_PASSCODE || '';
const TARGET = values.target;

const run = async () => {
  if (!PASSCODE) throw new Error('缺少 AUTH_PASSCODE');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const token = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');
  await context.addCookies([{ name: 'kb_session', value: token, url: BASE, httpOnly: true }]);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const url = TARGET === 'real' ? `${BASE}/graph` : `${BASE}/graph?fixture=${TARGET}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `artifacts/cluster-${TARGET}-first.png` });

  await page.waitForFunction(() => Array.isArray(window.__kbGraphNodePositions), null, { timeout: 90000 });
  await page.waitForTimeout(700); // 等首次 zoomToFit 动画结束
  await page.screenshot({ path: `artifacts/cluster-${TARGET}-aggregated.png` });

  // 聚焦：用验收钩子把「度数最高的节点」图坐标转屏幕坐标后精确点击
  let targetId = null;
  if (TARGET !== 'real') {
    const data = JSON.parse(readFileSync(`public/fixtures/${TARGET}.json`, 'utf8'));
    const degree = new Map();
    for (const edge of data.edges) {
      const s = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const t = typeof edge.target === 'object' ? edge.target.id : edge.target;
      degree.set(s, (degree.get(s) ?? 0) + 1);
      degree.set(t, (degree.get(t) ?? 0) + 1);
    }
    targetId = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  const spot = await page.evaluate((id) => {
    const fg = window.__kbGraphInstance;
    const positions = window.__kbGraphNodePositions ?? [];
    const target = id ? positions.find((p) => p.id === id) : positions[Math.floor(positions.length / 2)];
    if (!fg || !target) return null;
    const screen = fg.graph2ScreenCoords(target.x, target.y);
    return { x: screen.x, y: screen.y, id: target.id };
  }, targetId);

  let panelOpen = false;
  if (spot) {
    const canvas = await page.locator('canvas').first().boundingBox();
    const offsets = [
      [0, 0],
      [4, 0],
      [-4, 0],
      [0, 4],
      [0, -4],
    ];
    for (const [dx, dy] of offsets) {
      await page.mouse.click((canvas?.x ?? 0) + spot.x + dx, (canvas?.y ?? 0) + spot.y + dy);
      await page.waitForTimeout(600);
      panelOpen = (await page.locator('aside[aria-label="知识点详情"]').count()) > 0;
      if (panelOpen) break;
    }
  }
  await page.screenshot({ path: `artifacts/cluster-${TARGET}-focused.png` });

  console.log(JSON.stringify({ target: TARGET, focusedNode: spot?.id ?? null, panelOpen, pageErrors: errors }, null, 2));
  await browser.close();
  if (errors.length > 0) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
