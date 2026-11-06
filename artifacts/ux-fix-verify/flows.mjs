/**
 * 缺陷修复验收（浏览器 mock 流程）：不写库、不删除数据。
 * 覆盖 UX-06/07/08/09/10/13/19/20/22/25/27/28 + 学习闭环入口。
 * 用法：先起 dev server（3130），再 node kb-verify-flows.mjs
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

const result = { checks: [], consoleErrors: [], pageErrors: [] };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '  ' + JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, interval = 150) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(interval);
  }
  return false;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sse = (payloads) => payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');

async function newPage(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => result.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) result.consoleErrors.push(m.text().slice(0, 200));
  });
  return { context, page };
}

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

// ---------- A. /ask 多轮消息列表（UX-06） ----------
{
  const { context, page } = await newPage();
  let round = 0;
  await page.route('**/api/ai/config', (r) => r.fulfill({ json: { configured: true } }));
  await page.route('**/api/ai/ask', (route) => {
    round += 1;
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: sse([{ delta: `LEAD-回答${round}正文` }, { done: true, sources: [], actions: [], mode: 'agent' }]),
    });
  });
  await login(page);
  await page.goto(`${BASE}/ask`, { waitUntil: 'domcontentloaded' });
  const box = page.getByPlaceholder(/^例如：/).first();
  await box.waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 1; i <= 3; i += 1) {
    await box.fill(`LEAD-问题${i}`);
    await page.getByRole('button', { name: '发送' }).click();
    const ok = await waitFor(async () => (await page.getByText(`LEAD-回答${i}正文`).count()) > 0, 20000);
    check(`UX-06 第 ${i} 轮回答出现`, ok);
    await sleep(300);
  }
  for (let i = 1; i <= 3; i += 1) {
    const q = await page.getByText(`LEAD-问题${i}`).count();
    const a = await page.getByText(`LEAD-回答${i}正文`).count();
    check(`UX-06 第 ${i} 轮问题与回答同时在屏`, q > 0 && a > 0, { q, a });
  }
  await page.screenshot({ path: join(OUT, 'ask-3rounds.png'), fullPage: true });
  await context.close();
}

// ---------- B. 空 SSE 流：错误态 + 保留输入（UX-07） ----------
{
  const { context, page } = await newPage();
  await page.route('**/api/ai/config', (r) => r.fulfill({ json: { configured: true } }));
  await page.route('**/api/ai/ask', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, body: '' }),
  );
  await login(page);
  await page.goto(`${BASE}/ask`, { waitUntil: 'domcontentloaded' });
  const box = page.getByPlaceholder(/^例如：/).first();
  await box.waitFor({ state: 'visible', timeout: 30000 });
  await box.fill('LEAD-空流问题正文');
  await page.getByRole('button', { name: '发送' }).click();
  const errShown = await waitFor(async () => (await page.getByText('没有收到回答内容').count()) > 0, 20000);
  check('UX-07 空流进入错误态', errShown);
  const kept = await box.inputValue().catch(() => '');
  check('UX-07 空流后输入框内容保留', kept.includes('LEAD-空流问题正文'), kept);
  const retry = await page.getByRole('button', { name: /重试/ }).count();
  check('UX-07 错误态提供重试', retry > 0, retry);
  await page.screenshot({ path: join(OUT, 'ask-empty-stream.png'), fullPage: true });
  await context.close();
}

// ---------- C. 上下文 chips 失败可见（UX-08） ----------
{
  const segId = '55555555-5555-4555-8555-555555555555';
  const { context, page } = await newPage();
  await page.route('**/api/ai/config', (r) => r.fulfill({ json: { configured: true } }));
  await page.route(`**/api/segments/${segId}`, (r) => r.fulfill({ status: 500, json: { error: 'LEAD-上下文接口故障' } }));
  await login(page);
  await page.goto(`${BASE}/ask?segment=${segId}`, { waitUntil: 'domcontentloaded' });
  const warned = await waitFor(async () => (await page.getByText(/未能带入/).count()) > 0, 20000);
  check('UX-08 上下文拉取失败有可见提示', warned);
  await page.screenshot({ path: join(OUT, 'ask-context-failed.png'), fullPage: true });
  await context.close();
}

// ---------- D. 主动回忆：返回修改作答 + 下一条（UX-13） ----------
{
  const current = '33333333-3333-4333-8333-333333333333';
  const next = '77777777-7777-4777-8777-777777777777';
  const { context, page } = await newPage();
  await page.route('**/api/learning/question', (r) =>
    r.fulfill({
      json: {
        segment: { id: current, title: 'LEAD-当前知识点', documentId: '44444444-4444-4444-8444-444444444444', documentTitle: 'Java' },
        question: 'LEAD-哈希冲突怎么处理？',
        referenceAnswer: 'LEAD-链地址法并在长链表时树化',
        sourceVersion: 'a'.repeat(64),
        generatedBy: 'ai',
      },
    }),
  );
  await page.route('**/api/learning/today', (r) =>
    r.fulfill({
      json: {
        items: [
          { segmentId: current, title: 'LEAD-当前知识点', documentTitle: 'Java', memory: 0.4, reason: 'due' },
          { segmentId: next, title: 'LEAD-下一条知识点', documentTitle: 'Java', memory: 0.3, reason: 'due' },
        ],
        metrics: { reviewCount: 0, needsReviewCount: 0, improvedCount: 0, activeDays: 0 },
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route('**/api/learning/reviews', (r) =>
    r.fulfill({
      json: { duplicate: false, review: { id: 'review-1', reviewedAt: '2026-10-29T00:00:00.000Z', nextReviewAt: '2026-11-05T00:00:00.000Z' } },
    }),
  );
  await login(page);
  await page.goto(`${BASE}/study/${current}`, { waitUntil: 'domcontentloaded' });
  const answer = page.getByLabel('你的回答');
  await answer.waitFor({ state: 'visible', timeout: 30000 });
  await answer.fill('LEAD-我的作答内容');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  const revealed = await waitFor(async () => (await page.getByText('LEAD-链地址法并在长链表时树化').count()) > 0, 15000);
  check('UX-13① 揭晓参考答案可见', revealed);
  const backBtn = page.getByRole('button', { name: /返回修改作答/ });
  check('UX-13① 提供「返回修改作答」', (await backBtn.count()) > 0);
  if (await backBtn.count()) {
    await backBtn.click();
    await sleep(400);
    const hidden = (await page.getByText('LEAD-链地址法并在长链表时树化').count()) === 0;
    const value = await answer.inputValue().catch(() => '');
    check('UX-13① 返回后参考答案收起且作答保留', hidden && value.includes('LEAD-我的作答内容'), { hidden, value });
    await page.screenshot({ path: join(OUT, 'study-back-to-edit.png'), fullPage: true });
    await page.getByRole('button', { name: '查看参考答案' }).click();
    await sleep(300);
  }
  await page.getByRole('button', { name: /答对了/ }).click();
  const recorded = await waitFor(async () => (await page.getByText('复习已记录').count()) > 0, 15000);
  check('UX-13 提交后显示「复习已记录」', recorded);
  const nextLink = await waitFor(async () => (await page.getByRole('link', { name: /下一条/ }).count()) || (await page.getByRole('button', { name: /下一条/ }).count()), 15000);
  check('UX-13② 成功页提供「下一条」', Boolean(nextLink));
  await page.screenshot({ path: join(OUT, 'study-next.png'), fullPage: true });
  await context.close();
}

// ---------- E. 图谱：搜索选中即达 + 筛选全空空态（UX-10 / UX-28） ----------
{
  const { context, page } = await newPage(1440);
  await page.route('**/api/graph', (r) =>
    r.fulfill({
      json: {
        nodes: [
          { id: 'node-a', title: 'LEAD-遗忘曲线', memory: 0.72, viewCount: 3, readingMs: 60000, documentTitle: '学习科学' },
          { id: 'node-b', title: 'LEAD-间隔复习', memory: 0.45, viewCount: 2, readingMs: 42000, documentTitle: '学习科学' },
          { id: 'node-c', title: 'LEAD-记忆宫殿', memory: 0.2, viewCount: 1, readingMs: 30000, documentTitle: '学习科学' },
        ],
        edges: [
          { source: 'node-a', target: 'node-b', kind: 'doc', weight: 0.3 },
          { source: 'node-b', target: 'node-c', kind: 'doc', weight: 0.2 },
        ],
      },
    }),
  );
  await login(page);
  await page.goto(`${BASE}/graph`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
  await sleep(1200);
  await page.getByRole('button', { name: '搜索知识（Ctrl K）' }).click();
  const combo = page.getByRole('combobox', { name: '搜索知识' });
  await combo.waitFor({ state: 'visible', timeout: 10000 });
  await combo.fill('遗忘');
  await sleep(500);
  await combo.press('Enter');
  const detailOpen = await waitFor(async () => (await page.getByLabel('知识点详情').count()) > 0, 15000);
  check('UX-10 选中搜索结果后打开详情面板', detailOpen);
  const comboGone = await waitFor(async () => (await page.getByRole('combobox', { name: '搜索知识' }).count()) === 0, 8000);
  check('UX-10 选中后搜索浮层关闭', comboGone);
  await page.screenshot({ path: join(OUT, 'graph-search-detail.png') });

  // 详情面板是右侧抽屉，会盖住右上角设置按钮：先关闭详情再开设置
  const closeDetail = page.getByRole('button', { name: '关闭详情' });
  if (await closeDetail.count()) await closeDetail.first().click();
  await sleep(400);

  // 筛选全部取消 → 空态 + 重置
  await page.getByRole('button', { name: '关系图谱设置' }).click();
  await sleep(500);
  const filterTab = page.getByRole('button', { name: '筛选', exact: true });
  if (await filterTab.count()) await filterTab.first().click();
  await sleep(400);
  const boxes = page.locator('input[type="checkbox"]:visible');
  const total = await boxes.count();
  for (let i = 0; i < total; i += 1) {
    const box = boxes.nth(i);
    if (await box.isChecked().catch(() => false)) await box.uncheck({ force: true }).catch(() => {});
  }
  await sleep(800);
  const emptyShown = await waitFor(async () => (await page.getByText('无匹配节点').count()) > 0, 10000);
  check('UX-28 筛选全空显示「无匹配节点」空态', emptyShown, { checkboxes: total });
  await page.screenshot({ path: join(OUT, 'graph-filter-empty.png') });
  const reset = page.getByRole('button', { name: /重置筛选/ });
  check('UX-28 空态提供「重置筛选」', (await reset.count()) > 0);
  if (await reset.count()) {
    await reset.first().click();
    const restored = await waitFor(async () => (await page.getByText('无匹配节点').count()) === 0, 10000);
    check('UX-28 重置筛选后空态消失', restored);
  }
  await context.close();
}

// ---------- F. 401 统一跳登录（UX-25） ----------
{
  const { context, page } = await newPage();
  await login(page);
  await page.route('**/api/notes', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/notes' && route.request().method() === 'GET') return route.fulfill({ status: 401, json: { error: '未登录' } });
    return route.fallback();
  });
  await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
  const redirected = await waitFor(async () => page.url().includes('/login?next='), 15000);
  check('UX-25 API 401 后跳转 /login?next=当前路径', redirected, page.url());
  await context.close();
}

// ---------- G. 标注加载失败不冒充空数据（UX-27） ----------
{
  const { context, page } = await newPage();
  await page.route('**/api/notes/test-note-id', (r) =>
    r.fulfill({
      json: {
        document: { id: 'test-note-id', title: '测试文档', tags: [], segmentCount: 1, createdAt: '2026-10-29T00:00:00.000Z', storageKey: null },
        segments: [
          { id: '55555555-5555-4555-8555-555555555556', title: '索引', headingPath: '', tags: [], viewCount: 1, content: '数据库索引能减少扫描范围。', memory: 0.5 },
        ],
      },
    }),
  );
  await page.route('**/api/notes/test-note-id/annotations', (r) => r.fulfill({ status: 500, json: { error: 'LEAD-标注服务故障' } }));
  await login(page);
  await page.goto(`${BASE}/notes/test-note-id`, { waitUntil: 'domcontentloaded' });
  const warning = await waitFor(async () => (await page.getByText(/标注加载失败/).count()) > 0, 20000);
  check('UX-27 标注失败显示内联警告', warning);
  const retry = await page.getByRole('button', { name: '重试' }).count();
  check('UX-27 标注失败提供「重试」', retry > 0, retry);
  await page.screenshot({ path: join(OUT, 'notes-annotation-failed.png'), fullPage: true });
  await context.close();
}

// ---------- H. 导入：超大文件被拦截（UX-22） ----------
{
  const { context, page } = await newPage();
  await login(page);
  await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
  const fileInput = page.locator('input[type="file"]');
  await fileInput.waitFor({ state: 'attached', timeout: 15000 });
  await fileInput.setInputFiles({ name: 'lead-big.md', mimeType: 'text/markdown', buffer: Buffer.alloc(5 * 1024 * 1024, 97) });
  const rejected = await waitFor(async () => (await page.getByText(/4\s*MB|不超过|文件过大/).count()) > 0, 10000);
  check('UX-22 超大文件给出可读错误', rejected);
  if (rejected) check('UX-22 文件输入仍有「支持/不超过」提示', (await page.getByText(/支持|不超过/).count()) > 0);
  await page.screenshot({ path: join(OUT, 'import-too-big.png'), fullPage: true });
  await context.close();
}

// ---------- I. 设置页：自定义模型空值禁止保存；草稿 Key 测试（UX-19 / UX-20） ----------
{
  const { context, page } = await newPage();
  await login(page);
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const modelSelect = page.locator('select').first();
  await modelSelect.waitFor({ state: 'visible', timeout: 20000 });
  await modelSelect.selectOption('custom');
  await sleep(300);
  await page.getByRole('button', { name: '保存' }).click();
  const blocked = await waitFor(async () => (await page.getByText(/必须填写模型 id/).count()) > 0, 10000);
  check('UX-19 自定义模型为空时禁止保存并提示', blocked);
  const savedOk = await page.getByText(/已保存（模型/).count();
  check('UX-19 空模型未发出保存请求', savedOk === 0, savedOk);
  await page.screenshot({ path: join(OUT, 'settings-custom-empty.png'), fullPage: true });

  // 草稿 Key 测试：不带 body 与带草稿 body 的 keySource 应不同（前端按钮已带 body，这里直接验证接口契约）
  const draftProbe = await page.evaluate(async () => {
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-lead-draft-verify-0000', model: 'deepseek-v4-flash' }),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  });
  const data = draftProbe.data ?? {};
  check('UX-20 /api/ai/test 接受草稿 Key 并标记 keySource=draft', draftProbe.status === 200 && data.keySource === 'draft', { status: draftProbe.status, keySource: data.keySource });
  check('UX-20 响应不回显完整 Key', !JSON.stringify(data).includes('sk-lead-draft-verify-0000'), data.keyMask);
  await context.close();
}

// ---------- 汇总 ----------
const failed = result.checks.filter((c) => !c.pass);
writeFileSync(join(OUT, 'flows.json'), JSON.stringify(result, null, 2));
console.log('\n===== FLOW CHECKS =====');
for (const c of result.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : '  ' + JSON.stringify(c.detail)}`);
console.log(`\nSUMMARY ${result.checks.length - failed.length}/${result.checks.length} passed`);
if (result.pageErrors.length) console.log('PAGE ERRORS:', JSON.stringify(result.pageErrors.slice(0, 5)));
if (result.consoleErrors.length) console.log('CONSOLE ERRORS:', JSON.stringify(result.consoleErrors.slice(0, 5)));
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);




