/**
 * T04–T06 原型四视口截图与几何核对。
 * 使用仓库既有 playwright（不新增依赖）；静态 file:// 打开，模拟数据，无网络请求。
 * 输出：screenshots/*.png、screenshots/geometry.json、screenshots/geometry.md
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'screenshots');
mkdirSync(out, { recursive: true });

const PAGES = ['home', 'graph', 'detail'];
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'mobile-375x667', width: 375, height: 667 },
  { name: 'mobile-320x720', width: 320, height: 720 },
];

function url(file, query = '') {
  return pathToFileURL(join(dir, file)).href + query;
}

/**
 * 整页全貌截图专用：把固定底栏归位到页面底部。
 * Playwright fullPage 会把 position:fixed 元素画在「视口对应的滚动位置」，
 * 导致长页面的底栏出现在页面中部、看似压盖内容。这里仅在截图时改为 absolute，
 * 不改变任何尺寸、间距或布局逻辑；真实首屏另存 fullPage:false 的视口图。
 */
const SHOT_CSS = 'body{position:relative!important}' +
  '.bottom-nav{position:absolute!important;bottom:0!important;left:0!important;right:0!important}';
async function prepareShot(page) {
  await page.addStyleTag({ content: SHOT_CSS });
}

let browser;
try {
  // 本机未下载 Playwright 自带 browser，优先使用已安装的系统 Chrome
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
} catch (error) {
  console.log('系统 Chrome 启动失败，改用 Playwright Chromium：', error.message);
  browser = await chromium.launch({ headless: true });
}

const results = [];
const errors = [];

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' &&
        s.visibility !== 'hidden' && !e.closest('[hidden]');
    };
    const targets = Array.from(document.querySelectorAll(
      'button, input, .bottom-nav > a, .drawer-sheet a, .ku-node[role="button"]'
    )).filter(visible).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName.toLowerCase(),
        label: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 18),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
      };
    });
    const small = targets.filter((t) => t.w < 44 || t.h < 44);
    const navItems = Array.from(document.querySelectorAll('.bottom-nav > a, .bottom-nav > button'))
      .filter(visible).map((e) => +e.getBoundingClientRect().width.toFixed(1));
    const hit = document.querySelector('.ku-node .hit');
    const hitRect = hit ? hit.getBoundingClientRect() : null;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflowX: de.scrollWidth > de.clientWidth + 1,
      targetCount: targets.length,
      minTargetW: targets.length ? Math.min(...targets.map((t) => t.w)) : null,
      minTargetH: targets.length ? Math.min(...targets.map((t) => t.h)) : null,
      under44Count: small.length,
      under44: small.slice(0, 8),
      navItemCount: navItems.length,
      minNavItemW: navItems.length ? Math.min(...navItems) : null,
      svgHitPx: hitRect ? +Math.min(hitRect.width, hitRect.height).toFixed(1) : null,
    };
  });
}

try {
  // 1) 四视口 × 三页：整页截图 + 几何核对
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    for (const name of PAGES) {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${name}@${vp.name}: ${e.message}`));
      await page.goto(url(name + '.html'), { waitUntil: 'load' });
      await page.waitForTimeout(220);
      const geo = await measure(page);
      results.push({ viewport: vp.name, width: vp.width, height: vp.height, page: name, ...geo });
      if (vp.name === 'mobile-390x844') {
        // 真实首屏（保留 fixed 底栏），用于核对底栏位置与遮挡
        await page.screenshot({ path: join(out, `${name}-viewport-390x844.png`), fullPage: false });
      }
      await prepareShot(page);
      await page.screenshot({ path: join(out, `${name}-${vp.name}.png`), fullPage: true });
      console.log(`[base] ${name} @ ${vp.name} overflowX=${geo.overflowX} <44=${geo.under44Count} navMin=${geo.minNavItemW}`);
      await page.close();
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  // 2) 三页 × 三态（空 / 加载 / 错误）
  for (const name of PAGES) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}@state: ${e.message}`));
    await page.goto(url(name + '.html'), { waitUntil: 'load' });
    await prepareShot(page);
    for (const mode of ['empty', 'loading', 'error']) {
      await page.evaluate((m) => window.KU.setDataMode(m), mode);
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `${name}-state-${mode}.png`), fullPage: true });
      console.log(`[state] ${name} - ${mode}`);
    }
    await page.close();
  }

  // 3) 图谱四种交互态（桌面）
  const interaction = [
    { key: 'search', goto: url('graph.html', '?q=' + encodeURIComponent('记忆')) },
    { key: 'detail', goto: url('graph.html', '?node=n2') },
    { key: 'ai', goto: url('graph.html', '?node=n2&mode=ai') },
    { key: 'path', goto: url('graph.html', '?mode=path') },
  ];
  for (const item of interaction) {
    const page = await context.newPage();
    try {
      page.on('pageerror', (e) => errors.push(`${item.key}: ${e.message}`));
      await page.goto(item.goto, { waitUntil: 'load' });
      await prepareShot(page);
      await page.waitForTimeout(220);
      if (item.key === 'path') {
        // 选中节点会打开详情浮层；按 Esc 关闭后继续选第二个端点（路径上下文保留）
        await page.locator('.ku-node[data-node="n1"]').click();
        await page.keyboard.press('Escape');
        await page.locator('.ku-node[data-node="n5"]').click();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
      }
      await page.screenshot({ path: join(out, `graph-state-${item.key}.png`), fullPage: true });
      console.log(`[interaction] graph - ${item.key}`);
    } catch (error) {
      errors.push(`interaction ${item.key}: ${error.message}`);
      console.log(`[interaction] graph - ${item.key} FAILED: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  const summary = {
    capturedAt: new Date().toISOString(),
    viewports: VIEWPORTS.map((v) => v.name),
    pages: PAGES,
    totalOverflowX: results.filter((r) => r.overflowX).length,
    totalUnder44: results.reduce((n, r) => n + r.under44Count, 0),
    pageErrors: errors,
    results,
  };
  writeFileSync(join(out, 'geometry.json'), JSON.stringify(summary, null, 2) + '\n');

  const md = [
    '# 原型四视口几何核对',
    '',
    `采集时间：${summary.capturedAt}`,
    '',
    '| 页面 | 视口 | scrollWidth / clientWidth | 横向溢出 | 触控目标 <44px | 导航最小项宽 | SVG 热区 |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.page} | ${r.viewport} | ${r.scrollWidth} / ${r.clientWidth} | ${r.overflowX ? '**有**' : '无'} | ${r.under44Count} | ${r.minNavItemW}px | ${r.svgHitPx}px |`),
    '',
    `- 横向溢出合计：**${summary.totalOverflowX}**`,
    `- 触控目标不足 44px 合计：**${summary.totalUnder44}**`,
    `- 页面脚本错误：**${errors.length}**${errors.length ? '（' + errors.join('；') + '）' : ''}`,
    '',
    '> 检查对象：button / input / 底部导航项 / 抽屉项 / SVG 节点热区。正文内联文本链接按 WCAG 2.2 · 2.5.8 Inline 例外不计入 44px 目标尺寸。',
  ].join('\n');
  writeFileSync(join(out, 'geometry.md'), md + '\n');

  console.log('\n汇总：横向溢出', summary.totalOverflowX, '｜<44px', summary.totalUnder44, '｜页面错误', errors.length);
} finally {
  await browser.close();
}
