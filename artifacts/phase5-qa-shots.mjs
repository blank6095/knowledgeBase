/** 补拍：桌面主题面板、/notes 全站窄导航。 */
import { chromium } from 'playwright';

const baseURL = 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(`${baseURL}/login`);
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL(`${baseURL}/graph`);
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => (window.__kbGraphNodePositions ?? []).length > 0, undefined, { timeout: 60000 });
  await page.locator('nav[aria-label="知识宇宙导航"] [aria-label="外观主题"]').click();
  await page.locator('section[aria-label="图谱外观主题"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/phase5-qa-theme-panel.png' });
  await page.goto(`${baseURL}/notes`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/phase5-qa-notes-rail.png' });
  console.log('captured theme-panel + notes-rail');
} finally {
  await browser.close().catch(() => {});
}
