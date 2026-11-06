/**
 * 缺陷修复验收（只读）：320/390/768/1440 四视口量取
 * - 移动底部导航可见项数量与最小触控宽度（UX-01）
 * - 文档页悬浮目录钮与底部导航是否重叠（UX-02）
 * - 编辑模式段标题输入框宽度、横向溢出（UX-03）
 * - 页脚文字是否被底部导航压盖（UX-04）
 * - 登录页品牌与无障碍（UX-05/24）
 * 用法：先起 dev server（3130），再 node kb-verify-geometry.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const cwd = process.cwd();
const require = createRequire(pathToFileURL(join(cwd, 'package.json')));
const { chromium } = require('playwright');
const BASE = process.env.VERIFY_BASE ?? 'http://127.0.0.1:3130';
const OUT = join(cwd, 'artifacts', 'ux-fix-verify');
mkdirSync(OUT, { recursive: true });
const passcode = readFileSync(join(cwd, '.env.local'), 'utf8').match(/^AUTH_PASSCODE\s*=\s*(.*)$/m)[1].trim();

const result = { viewports: {}, consoleErrors: [], pageErrors: [], checks: [] };
const check = (name, pass, detail) => result.checks.push({ name, pass: Boolean(pass), detail });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('访问口令');
  const submit = page.getByRole('button', { name: '进入' });
  await input.waitFor({ state: 'visible', timeout: 30000 });
  // 水合竞态：按钮可点击前反复填值，避免 React 水合把 DOM 值冲掉后再也点不动
  for (let i = 0; i < 40; i += 1) {
    await input.fill(passcode);
    if (await submit.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(150);
  }
  await submit.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
}

const measure = () => {
  const nav = document.querySelector('nav[aria-label="知识宇宙导航"]');
  const navRect = nav?.getBoundingClientRect();
  const navItems = nav
    ? [...nav.querySelectorAll('a,button')]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({
          label: el.getAttribute('aria-label'),
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        }))
    : [];
  const tocBtn = document.querySelector('button[aria-label="打开目录"]');
  const tocRect = tocBtn?.getBoundingClientRect();
  const overlap =
    tocRect && navRect
      ? !(tocRect.right < navRect.left || tocRect.left > navRect.right || tocRect.bottom < navRect.top || tocRect.top > navRect.bottom)
      : null;
  const footerText = document.querySelector('footer p')?.getBoundingClientRect();
  const footerCovered = footerText && navRect ? footerText.bottom > navRect.top : null;
  return {
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    nav: navRect ? { top: Math.round(navRect.top), bottom: Math.round(navRect.bottom), count: navItems.length } : null,
    navItems,
    navMinWidth: navItems.length ? Math.min(...navItems.map((i) => i.w)) : null,
    tocButton: tocRect ? { top: Math.round(tocRect.top), bottom: Math.round(tocRect.bottom), overlapsNav: overlap } : null,
    footerTextBottom: footerText ? Math.round(footerText.bottom) : null,
    footerCovered,
    firstDocHref: document.querySelector('a[href^="/notes/"]')?.getAttribute('href') ?? null,
  };
};

for (const width of [320, 390, 768, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => result.pageErrors.push(`${width} :: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(`${width} ${page.url()} :: ${m.text()}`.slice(0, 300));
  });
  const record = {};
  result.viewports[width] = record;

  // 登录页（未登录）：品牌 + 无障碍
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  record.login = {
    heading: await page.locator('h1').first().textContent(),
    hasLabel: (await page.getByLabel('访问口令').count()) > 0,
  };
  if (width === 390) {
    check('UX-05 登录页标题为「知识宇宙」', record.login.heading?.trim() === '知识宇宙', record.login.heading);
    check('UX-24 口令框有关联 label', record.login.hasLabel, record.login.hasLabel);
  }

  await login(page);

  for (const path of ['/', '/notes', '/ask', '/import', '/settings', '/progress']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    record[path] = await page.evaluate(measure);
  }

  // 文档详情（真实数据，只读）：直接问接口拿 id，避免列表在慢视口还没渲染出链接
  let href = null;
  try {
    const res = await page.request.get(`${BASE}/api/notes`);
    const payload = await res.json();
    const first = (payload.documents ?? [])[0];
    if (first?.id) href = `/notes/${first.id}`;
  } catch {
    href = null;
  }
  if (!href) {
    await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    href = await page.locator('a[href^="/notes/"]').first().getAttribute('href').catch(() => null);
  }
  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    record[href] = await page.evaluate(measure);
    const editBtn = page.getByRole('button', { name: '✎ 编辑' });
    if (await editBtn.count()) {
      await editBtn.first().click();
      await page.waitForTimeout(700);
      record[`${href}#edit`] = await page.evaluate(() => {
        const title = document.querySelector('section input[placeholder="段落标题"]');
        const r = title?.getBoundingClientRect();
        const toolbar = title?.closest('div')?.querySelector('div.flex.shrink-0');
        const tr = toolbar?.getBoundingClientRect();
        return {
          titleInputWidth: r ? Math.round(r.width) : null,
          toolbarWidth: tr ? Math.round(tr.width) : null,
          sameRow: r && tr ? Math.abs(r.top - tr.top) < 8 : null,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      if (width === 320 || width === 390) {
        await page.screenshot({ path: join(OUT, `edit-${width}.png`) });
      }
      if (await page.getByRole('button', { name: '✓ 完成编辑' }).count()) {
        await page.getByRole('button', { name: '✓ 完成编辑' }).first().click();
        await page.waitForTimeout(400);
      }
    }
  }

  // 图谱页（沉浸式，自己渲染导航）
  await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  record['/graph'] = await page.evaluate(measure);
  await page.screenshot({ path: join(OUT, `graph-${width}.png`) });

  // 断言
  const mobile = width < 768;
  const nav = record['/notes']?.nav;
  if (mobile) {
    check(`UX-01 ${width}px 导航可见项为 3 核心 + 更多`, nav?.count === 4, nav?.count);
    check(`UX-01 ${width}px 导航最小触控宽度 ≥44px`, (record['/notes']?.navMinWidth ?? 0) >= 44, record['/notes']?.navMinWidth);
    check(`UX-04 ${width}px 页脚文字未被导航压盖`, record['/notes']?.footerCovered === false, {
      footerTextBottom: record['/notes']?.footerTextBottom,
      navTop: nav?.top,
    });
  } else {
    check(`UX-01 ${width}px 桌面导航最小触控宽度 ≥44px`, (record['/notes']?.navMinWidth ?? 0) >= 44, record['/notes']?.navMinWidth);
  }
  if (href && mobile) {
    check(`UX-02 ${width}px 目录钮不与底部导航重叠`, record[href]?.tocButton?.overlapsNav === false, record[href]?.tocButton);
    check(`UX-03 ${width}px 段标题输入框 ≥120px`, (record[`${href}#edit`]?.titleInputWidth ?? 0) >= 120, record[`${href}#edit`]?.titleInputWidth);
    check(`UX-03 ${width}px 编辑态无横向溢出`, record[`${href}#edit`]?.overflowX === 0, record[`${href}#edit`]?.overflowX);
  }
  if (href && !mobile) {
    check(`UX-03 ${width}px 桌面工具行仍为单行`, record[`${href}#edit`]?.sameRow === true, record[`${href}#edit`]);
  }
  if (mobile) {
    check(`UX-01 ${width}px 图谱页导航同为紧凑 4 项`, record['/graph']?.nav?.count === 4, record['/graph']?.nav?.count);
  }
  const overflowPages = Object.entries(record).filter(([k, v]) => v && typeof v === 'object' && 'overflowX' in v && v.overflowX !== 0);
  check(`${width}px 全页面无横向溢出`, overflowPages.length === 0, overflowPages.map(([k, v]) => `${k}:${v.overflowX}`));

  await context.close();
}

check('无运行时 JS 错误', result.pageErrors.length === 0, result.pageErrors.slice(0, 5));
check('无 console 错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 5));

writeFileSync(join(OUT, 'geometry.json'), JSON.stringify(result, null, 2));
const failed = result.checks.filter((c) => !c.pass);
console.log('\n===== GEOMETRY CHECKS =====');
for (const c of result.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${c.pass ? '' : JSON.stringify(c.detail)}`);
console.log(`\nSUMMARY ${result.checks.length - failed.length}/${result.checks.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);



