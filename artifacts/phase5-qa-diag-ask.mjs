/** 诊断：/ask?path 移除单个 chip 后 DOM 状态与「全部清除」是否存在。 */
import { chromium, request } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/graph`);
  const api = await request.newContext({ baseURL });
  await api.post('/api/auth/login', { data: { passcode } });
  const payload = await (await api.get('/api/graph')).json();
  const [a, b] = payload.nodes.map((n) => n.id);
  await page.goto(`${baseURL}/ask?path=${a},${b}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-label="当前上下文"]').waitFor({ state: 'visible', timeout: 20000 });
  console.log('loaded url', page.url());
  console.log('chips', await page.locator('[aria-label^="移除上下文"]').count());
  console.log('clearAll', await page.getByRole('button', { name: /全部清除/ }).count());
  await page.locator('[aria-label^="移除上下文"]').first().click();
  for (const wait of [300, 800, 1500, 3000]) {
    await page.waitForTimeout(wait);
    const st = await page.evaluate(() => ({
      url: location.href,
      section: document.querySelectorAll('section[aria-label="当前上下文"]').length,
      chips: document.querySelectorAll('[aria-label^="移除上下文"]').length,
      clear: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('全部清除')).length,
      bodyHas: document.body.innerText.includes('当前上下文'),
      loading: document.querySelectorAll('[aria-label="当前上下文加载中"]').length,
    }));
    console.log('after+' + wait, JSON.stringify(st));
  }
  // 再次尝试点全部清除
  const btn = page.getByRole('button', { name: /全部清除/ });
  console.log('final clearAll count', await btn.count());
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(800);
    console.log('after clear', JSON.stringify(await page.evaluate(() => ({ url: location.href, section: document.querySelectorAll('section[aria-label="当前上下文"]').length, chips: document.querySelectorAll('[aria-label^="移除上下文"]').length }))));
  }
  console.log('errors', errors);
} finally {
  await browser.close().catch(() => {});
}
