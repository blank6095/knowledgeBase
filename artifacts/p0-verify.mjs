/**
 * P0 验收：阅读视图内链渲染 + 全局 QuickSwitcher。
 *
 * 校验点：
 * 1. [[标题]] 渲染为 .wiki-link 链接，视觉不含括号；
 * 2. DOM textContent 仍保留 `[[标题]]` 原文（批注锚点不错位）；
 * 3. 点击内链跳到目标知识点；
 * 4. 非 /graph 页 Ctrl+K 打开 QuickSwitcher，输入标题回车跳转；
 * 5. 全程无 pageerror。
 *
 * 用法：node --env-file=.env.local artifacts/p0-verify.mjs
 */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3100' },
    doc: { type: 'string', default: '258c90af-dc62-40a2-b366-71a5d7b2de64' },
    target: { type: 'string', default: 'c2cd410f-c3cf-4d1a-b16c-bfa1b850ce31' },
    passcode: { type: 'string', default: '' },
  },
});

const BASE = values.base;
const PASSCODE = values.passcode || process.env.AUTH_PASSCODE || '';

const run = async () => {
  if (!PASSCODE) throw new Error('缺少 AUTH_PASSCODE');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const token = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');
  await context.addCookies([{ name: 'kb_session', value: token, url: BASE, httpOnly: true }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1) 阅读视图：内链渲染
  await page.goto(`${BASE}/notes/${values.doc}`, { waitUntil: 'networkidle' });
  const link = page.locator('.md-body a.wiki-link').first();
  await link.waitFor({ timeout: 20000 });
  // 可见文本：剔除 .wiki-hidden（括号与「标题|」）后的结果
  const visibleText = await link.evaluate((el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.wiki-hidden').forEach((node) => node.remove());
    return (clone.textContent ?? '').trim();
  });
  const href = await link.getAttribute('href');
  const hiddenFontSize = await link.evaluate((el) => {
    const hidden = el.querySelector('.wiki-hidden');
    return hidden ? getComputedStyle(hidden).fontSize : null;
  });
  // 2) textContent 保留原文（隐藏括号仍在 DOM 中，批注锚点依赖）
  const keepsRawMarkup = await page.evaluate(() =>
    [...document.querySelectorAll('.md-body')].some((el) => (el.textContent ?? '').includes('[[TCP 与 UDP]]')),
  );
  const rendered = { text: visibleText, href, hiddenFontSize };
  await page.screenshot({ path: 'artifacts/p0-wikilink.png' });

  // 3) 点击内链跳转
  await link.click();
  await page.waitForURL(`**/segments/${values.target}`, { timeout: 20000 });
  const jumped = new URL(page.url()).pathname;

  // 4) QuickSwitcher：非图谱页 Ctrl+K
  await page.goto(`${BASE}/notes`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: '全局检索' });
  await dialog.waitFor({ timeout: 10000 });
  await page.getByLabel('搜索知识点').fill('OSI');
  const firstOption = page.locator('[role="option"]').first();
  await firstOption.waitFor({ timeout: 15000 });
  const switcherText = (await firstOption.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: 'artifacts/p0-quickswitcher.png' });
  await page.keyboard.press('Enter');
  await page.waitForURL(`**/segments/cfd0465f-349a-4481-91bf-433db22fe3f7`, { timeout: 20000 });
  const switcherJump = new URL(page.url()).pathname;

  console.log(
    JSON.stringify(
      {
        wikilink: { renderedText: rendered.text, href: rendered.href, keepsRawMarkup },
        clickJump: jumped,
        switcher: { result: switcherText, jump: switcherJump },
        pageErrors: errors,
      },
      null,
      2,
    ),
  );

  await browser.close();
  const ok =
    rendered.text === 'TCP 与 UDP' &&
    rendered.href === `/segments/${values.target}` &&
    rendered.hiddenFontSize === '0px' &&
    keepsRawMarkup &&
    jumped === `/segments/${values.target}` &&
    switcherJump === '/segments/cfd0465f-349a-4481-91bf-433db22fe3f7' &&
    errors.length === 0;
  if (!ok) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
