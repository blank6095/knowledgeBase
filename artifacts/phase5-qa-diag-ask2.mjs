/** 诊断 2：全部清除 / 单 chip 移除后的上下文状态（是否存在永久 loading）。 */
import { chromium, request } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const state = () =>
  page.evaluate(() => ({
    url: location.href,
    section: document.querySelectorAll('section[aria-label="当前上下文"]').length,
    chips: document.querySelectorAll('[aria-label^="移除上下文"]').length,
    loading: document.querySelectorAll('[aria-label="当前上下文加载中"]').length,
    clearBtn: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('全部清除')).length,
    bodyHasContext: document.body.innerText.includes('当前上下文'),
  }));
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/graph`);
  const api = await request.newContext({ baseURL });
  await api.post('/api/auth/login', { data: { passcode } });
  const payload = await (await api.get('/api/graph')).json();
  const [a, b] = payload.nodes.map((n) => n.id);

  // A. path 两个 chip → 全部清除
  await page.goto(`${baseURL}/ask?path=${a},${b}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-label="当前上下文"]').waitFor({ state: 'visible', timeout: 20000 });
  console.log('A loaded', JSON.stringify(await state()));
  await page.getByRole('button', { name: /全部清除/ }).click();
  await page.waitForTimeout(2500);
  console.log('A after clear', JSON.stringify(await state()));

  // B. segment 单个 chip → 移除
  await page.goto(`${baseURL}/ask?segment=${a}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-label="当前上下文"]').waitFor({ state: 'visible', timeout: 20000 });
  console.log('B loaded', JSON.stringify(await state()));
  await page.locator('[aria-label^="移除上下文"]').first().click();
  await page.waitForTimeout(2500);
  console.log('B after remove', JSON.stringify(await state()));
} finally {
  await browser.close().catch(() => {});
}
