/**
 * 前端缺陷实测（只读：不保存任何编辑、不删除数据）。
 * 量取各页面在 320/390/768/1440 视口下的横向溢出、底部导航条目尺寸、
 * 文档页悬浮目录钮与底部导航的重叠、段编辑卡工具栏挤压情况。
 * 用法：先起 dev server（3130），再 node --env-file=.env.local artifacts/ux-defect-audit.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')));
const { chromium } = require('playwright');
const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:3130';
const OUT = join(process.cwd(), 'artifacts', 'ux-defect');
mkdirSync(OUT, { recursive: true });
const passcode = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  .match(/^AUTH_PASSCODE\s*=\s*(.*)$/m)[1]
  .trim();

const result = { viewports: {}, consoleErrors: [], pageErrors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('访问口令');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(passcode);
  const btn = page.getByRole('button', { name: '进入' });
  for (let i = 0; i < 20 && !(await btn.isEnabled()); i += 1) await page.waitForTimeout(200);
  await btn.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
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
      ? !(
          tocRect.right < navRect.left ||
          tocRect.left > navRect.right ||
          tocRect.bottom < navRect.top ||
          tocRect.top > navRect.bottom
        )
      : null;
  return {
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    nav: navRect ? { top: Math.round(navRect.top), bottom: Math.round(navRect.bottom), count: navItems.length } : null,
    navItems,
    tocButton: tocRect
      ? { top: Math.round(tocRect.top), bottom: Math.round(tocRect.bottom), right: Math.round(tocRect.right), overlapsNav: overlap }
      : null,
    firstDocHref: document.querySelector('a[href^="/notes/"]')?.getAttribute('href') ?? null,
  };
};

for (const width of [320, 390, 768, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.pageErrors.push(`${width} :: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) {
      result.consoleErrors.push(`${width} ${page.url()} :: ${m.text()}`.slice(0, 300));
    }
  });
  const record = {};
  result.viewports[width] = record;
  await login(page);

  for (const path of ['/', '/notes', '/ask', '/import', '/settings', '/progress']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    record[path] = await page.evaluate(measure);
  }

  // 文档详情（真实数据，只读）+ 编辑模式工具栏测量（不保存）
  const href = record['/notes']?.firstDocHref;
  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    record[href] = await page.evaluate(measure);
    const editBtn = page.getByRole('button', { name: '✎ 编辑' });
    if (await editBtn.count()) {
      await editBtn.first().click();
      await page.waitForTimeout(600);
      record[`${href}#edit`] = await page.evaluate(() => {
        const title = document.querySelector('section input[placeholder="段落标题"]');
        const r = title?.getBoundingClientRect();
        const toolbar = title?.parentElement?.querySelector('div.flex.shrink-0');
        return {
          titleInputWidth: r ? Math.round(r.width) : null,
          toolbarWidth: toolbar ? Math.round(toolbar.getBoundingClientRect().width) : null,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      await page.getByRole('button', { name: '✓ 完成编辑' }).first().click();
    }
  }

  await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  record['/graph'] = await page.evaluate(measure);
  await page.screenshot({ path: join(OUT, `graph-${width}.png`) });
  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `note-${width}.png`) });
  }
  await context.close();
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
