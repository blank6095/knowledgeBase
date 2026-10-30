/** 复测：/ask?segment chip 加载 + 控制台错误是否可复现（隔离环境）。 */
import { chromium, request } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200));
});
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/graph`);
  const api = await request.newContext({ baseURL });
  await api.post('/api/auth/login', { data: { passcode } });
  const payload = await (await api.get('/api/graph')).json();
  const id = payload.nodes[0].id;
  const title = payload.nodes[0].title;
  const t0 = Date.now();
  await page.goto(`${baseURL}/ask?segment=${id}`, { waitUntil: 'domcontentloaded' });
  const section = page.locator('section[aria-label="当前上下文"]');
  await section.waitFor({ state: 'visible', timeout: 25_000 });
  const elapsed = Date.now() - t0;
  console.log('segment chip OK', JSON.stringify({ id: id.slice(0, 8), title, elapsed, text: (await section.innerText()).replace(/\s+/g, ' ') }));
  const placeholder = await page.locator('input:not([type="hidden"]), textarea').first().getAttribute('placeholder');
  console.log('placeholder', placeholder);
  console.log('errors', errs);
} finally {
  await browser.close().catch(() => {});
}
