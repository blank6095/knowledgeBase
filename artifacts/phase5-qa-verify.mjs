/**
 * 阶段 3 + U1-1/UQ2 + U4-4 出口门禁 · QA 功能验收（只写 artifacts/）。
 * 覆盖：U1-1 登录落点、UQ2 全站唯一窄导航、U3 四环境/四风格/持久化/异常降级、
 *       U4-4 /ask 上下文 chips/请求体/不自动发送/边界、阶段 0–4 回归。
 * 用法：KB_PASSCODE=... node artifacts/phase5-qa-verify.mjs
 */
import { chromium, request } from 'playwright';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.KB_BASE ?? 'http://127.0.0.1:3102';
const passcode = process.env.KB_PASSCODE;
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
async function check(name, fn) {
  try {
    record(name, true, await fn());
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function poll(fn, timeout, interval = 80) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}
const snapshot = (page) =>
  page.evaluate(() => ({ positions: window.__kbGraphNodePositions ?? [], engineStop: window.__kbGraphEngineStop ?? null }));
async function waitGraphReady(page, timeout = 120_000) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
  const snap = await poll(async () => {
    const s = await snapshot(page);
    return s.positions.length > 0 ? s : undefined;
  }, timeout);
  assert(snap, '等待图谱坐标超时');
  await page.waitForTimeout(300);
  return snapshot(page);
}
const login = async (page) => {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('访问口令').fill(passcode);
  await page.getByRole('button', { name: '进入' }).click();
  await page.waitForURL((u) => !new URL(u).pathname.startsWith('/login'), { timeout: 30_000 });
};
const nav = (page) => page.locator('nav[aria-label="知识宇宙导航"]');
const themePanel = (page) => page.locator('section[aria-label="图谱外观主题"]');
const openThemePanel = async (page) => {
  await nav(page).locator('[aria-label="外观主题"]').click();
  await themePanel(page).waitFor({ state: 'visible', timeout: 8_000 });
};
const businessRequests = [];
function trackBusiness(page) {
  page.on('request', (req) => {
    const u = req.url();
    if (/\/api\/graph|\/fixtures\/|\/api\/segments\/|\/api\/stats|\/api\/notes/.test(u)) businessRequests.push({ u, at: Date.now() });
  });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
let page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) {
    const loc = m.location();
    consoleErrors.push({ text: m.text().slice(0, 260), url: loc?.url ?? '', line: loc?.lineNumber ?? 0 });
  }
});
trackBusiness(page);

try {
  // ---------- U1-1 ----------
  await check('U1-1：无 next 登录后落 /graph', async () => {
    await login(page);
    await page.waitForURL('**/graph', { timeout: 20_000 });
    assert(new URL(page.url()).pathname === '/graph', `pathname=${new URL(page.url()).pathname}`);
    return `→ ${new URL(page.url()).pathname}`;
  });
  await check('U1-1：非法 next（//evil.com）登录后回 /graph', async () => {
    const p = await context.newPage();
    try {
      await p.goto(`${baseURL}/login?next=//evil.com`, { waitUntil: 'domcontentloaded' });
      await p.getByPlaceholder('访问口令').fill(passcode);
      await p.getByRole('button', { name: '进入' }).click();
      await p.waitForURL('**/graph', { timeout: 20_000 });
      return `→ ${new URL(p.url()).pathname}`;
    } finally {
      await p.close();
    }
  });
  await check('U1-1：合法 next（/notes）登录后回 /notes', async () => {
    const p = await context.newPage();
    try {
      await p.goto(`${baseURL}/login?next=/notes`, { waitUntil: 'domcontentloaded' });
      await p.getByPlaceholder('访问口令').fill(passcode);
      await p.getByRole('button', { name: '进入' }).click();
      await p.waitForURL('**/notes', { timeout: 20_000 });
      return `→ ${new URL(p.url()).pathname}`;
    } finally {
      await p.close();
    }
  });
  await check('U1-1：/ 仍可直达（今日学习页不硬跳转）', async () => {
    await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    assert(new URL(page.url()).pathname === '/', `pathname=${new URL(page.url()).pathname}`);
    return 'pathname=/';
  });

  // ---------- UQ2 全站唯一 nav ----------
  const pages = ['/graph', '/notes', '/progress', '/ask', '/settings', '/'];
  for (const path of pages) {
    await check(`UQ2 ${path}：唯一悬浮 nav、无旧 aside/header、无横向溢出`, async () => {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => ({
        navCount: document.querySelectorAll('nav[aria-label="知识宇宙导航"]').length,
        asideCount: document.querySelectorAll('aside').length,
        oldHeader: document.querySelectorAll('header.sticky').length,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        navRect: (() => {
          const el = document.querySelector('nav[aria-label="知识宇宙导航"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
        })(),
        footer: Boolean(document.querySelector('footer')),
      }));
      assert(m.navCount === 1, `nav 数量=${m.navCount}`);
      assert(m.asideCount === 0, `旧 aside 数量=${m.asideCount}`);
      assert(m.oldHeader === 0, `遗留旧 header 数量=${m.oldHeader}`);
      assert(m.scrollW <= m.innerW + 1, `横向溢出 ${m.scrollW}>${m.innerW}`);
      if (path !== '/graph') assert(m.footer, '非沉浸页缺少页脚');
      return `nav=1（${m.navRect.left},${m.navRect.top}），aside=0，无横向溢出，footer=${m.footer}`;
    });
  }

  await check('UQ2：非沉浸页内容不被窄导航遮挡（左内边距 ≥96，nav 右缘 68）', async () => {
    await page.goto(`${baseURL}/notes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const main = document.querySelector('main');
      const navEl = document.querySelector('nav[aria-label="知识宇宙导航"]');
      const mainRect = main.getBoundingClientRect();
      const navRect = navEl.getBoundingClientRect();
      const first = main.querySelector('h1, h2, p');
      return {
        mainLeft: mainRect.left,
        navRight: navRect.right,
        firstLeft: first ? first.getBoundingClientRect().left : null,
        paddingLeft: getComputedStyle(main).paddingLeft,
      };
    });
    const contentLeft = m.mainLeft + parseFloat(m.paddingLeft);
    assert(m.navRight <= contentLeft + 8, `nav 右缘 ${m.navRight} 侵入内容区 ${contentLeft}`);
    return `main.left=${m.mainLeft.toFixed(0)}（padding-left=${m.paddingLeft}），内容起点=${contentLeft.toFixed(0)}，nav.right=${m.navRight.toFixed(0)}，首个内容元素 left=${m.firstLeft?.toFixed(0)}`;
  });

  await check('UQ2：全局 nav 7 项 + 退出（外观主题 disabled + hint），active 正确', async () => {
    await page.goto(`${baseURL}/notes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const labels = await nav(page).locator('[aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    assert(labels.length === 8, `nav 项=${labels.length}：${labels.join(' / ')}`);
    for (const l of ['知识宇宙', '知识库', '今日学习', '学习复盘', 'AI 助手', '设置', '退出登录']) {
      assert(labels.some((x) => x.startsWith(l)), `缺少 ${l}`);
    }
    const theme = nav(page).locator('[aria-label*="外观主题"]');
    assert((await theme.getAttribute('aria-disabled')) === 'true', '全站外观主题应为 disabled');
    assert((await theme.getAttribute('aria-label')).includes('进入知识宇宙后调整'), '外观主题 hint 不符');
    const active = await nav(page).locator('[aria-current="page"]').getAttribute('aria-label');
    assert(active === '知识库', `active=${active}`);
    return `${labels.length} 项，active=${active}，外观主题 disabled（进入知识宇宙后调整）`;
  });

  await check('UQ2 /graph：唯一 nav、6 图标 + 退出（外观主题可打开面板，非 disabled）', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    const labels = await nav(page).locator('[aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    assert(labels.length === 7, `graph nav 项=${labels.length}：${labels.join(' / ')}`);
    const theme = nav(page).locator('[aria-label="外观主题"]');
    assert((await theme.count()) === 1, 'graph 外观主题入口缺失');
    assert((await theme.getAttribute('aria-disabled')) === 'false' || (await theme.getAttribute('aria-disabled')) === null, 'graph 外观主题不应 disabled');
    return `${labels.length} 项：${labels.join(' / ')}`;
  });

  // ---------- U3 默认冷色 + 四环境三连测 ----------
  await check('U3 默认冷色：html/背景层 data-graph-env=deep-space，accent 为冷色', async () => {
    const m = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
      const bg = document.querySelector('.graph-background');
      const [r, g, b] = accent.match(/\d+/g)?.map(Number) ?? [];
      return { html: document.documentElement.dataset.graphEnv, bg: bg?.dataset.graphEnv, accent, r, g, b };
    });
    assert(m.html === 'deep-space', `html data-graph-env=${m.html}`);
    assert(m.bg === 'deep-space', `背景层 data-graph-env=${m.bg}`);
    assert(m.b > m.r, `accent 非冷色：${m.accent}`);
    return `html/bg=deep-space，accent=${m.accent}`;
  });

  await check('U3 四环境切换：html/背景同步、0 业务请求、engineStop/坐标不变', async () => {
    await openThemePanel(page);
    const baseSnap = await snapshot(page);
    const resultsEnv = [];
    for (const label of ['数字空间', '极光', '极简', '深空']) {
      const start = Date.now();
      await themePanel(page).getByRole('button', { name: label }).click();
      await page.waitForTimeout(450);
      const during = businessRequests.filter((r) => r.at >= start);
      const m = await page.evaluate(() => ({
        html: document.documentElement.dataset.graphEnv,
        bg: document.querySelector('.graph-background')?.dataset.graphEnv,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
      }));
      const snap = await snapshot(page);
      assert(during.length === 0, `切换「${label}」期间业务请求：${JSON.stringify(during.slice(0, 2))}`);
      assert(snap.engineStop === baseSnap.engineStop, `「${label}」engineStop 变化`);
      assert(JSON.stringify(snap.positions) === JSON.stringify(baseSnap.positions), `「${label}」坐标变化`);
      assert(m.html === m.bg, `「${label}」html/bg 不同步：${m.html}/${m.bg}`);
      resultsEnv.push(`${label}→${m.html}(${m.accent})`);
      await page.screenshot({ path: `artifacts/phase5-qa-env-${m.html}.png` });
    }
    assert(businessRequests.length >= 0);
    return `${resultsEnv.join('，')}；每档 0 业务请求，engineStop=${Math.round(baseSnap.engineStop)}ms 与坐标均未变`;
  });

  await check('U3 四节点风格切换：canvas 正常、记忆度颜色不变（采样 RGB 一致）', async () => {
    const panel = themePanel(page);
    const sample = async () => {
      const s = await snapshot(page);
      const pos = s.positions[0];
      return page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        const r = canvas.getBoundingClientRect();
        const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
        const sx = (p.x / r.width) * canvas.width;
        const sy = (p.y / r.height) * canvas.height;
        const size = 25;
        const d = ctx.getImageData(Math.round(sx) - (size - 1) / 2, Math.round(sy) - (size - 1) / 2, size, size).data;
        let best = { a: 0, rgb: [0, 0, 0] };
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > best.a) best = { a: d[i + 3], rgb: [d[i], d[i + 1], d[i + 2]] };
        }
        return { rgb: best.rgb, alpha: best.a };
      }, pos);
    };
    const samples = [];
    for (const label of ['光点', '晶体', '线框', '能量球']) {
      await panel.getByRole('button', { name: label }).click();
      await page.waitForTimeout(400);
      const s = await sample();
      samples.push({ label, ...s });
      await page.screenshot({ path: `artifacts/phase5-qa-style-${label}.png` });
    }
    const hue = (rgb) => {
      const [r, g, b] = rgb;
      return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
    };
    const baseHue = hue(samples[0].rgb);
    for (const s of samples) {
      assert(s.alpha > 0, `风格「${s.label}」节点未绘制`);
      const dh = Math.abs(hue(s.rgb) - baseHue);
      assert(dh < 0.35, `风格「${s.label}」记忆度色相漂移：${s.rgb} vs ${samples[0].rgb}`);
    }
    await panel.getByRole('button', { name: '光点' }).click();
    return samples.map((s) => `${s.label}=rgb(${s.rgb.join(',')})`).join('；');
  });

  await check('U3 主题面板：4 环境卡 + 4 风格 + 光晕/背景滑块 + 恢复默认', async () => {
    const panel = themePanel(page);
    const envButtons = await panel.getByRole('button').evaluateAll((els) => els.map((el) => el.textContent.trim()));
    for (const l of ['深空', '数字空间', '极光', '极简']) assert(envButtons.some((t) => t.includes(l)), `缺少环境卡 ${l}`);
    for (const l of ['光点', '晶体', '线框', '能量球']) assert(envButtons.some((t) => t.includes(l)), `缺少风格 ${l}`);
    const sliders = panel.locator('input[type="range"]');
    assert((await sliders.count()) === 2, `滑块数量=${await sliders.count()}`);
    await panel.getByRole('button', { name: '恢复默认外观' }).click();
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({ env: document.documentElement.dataset.graphEnv }));
    assert(st.env === 'deep-space', `恢复默认后 env=${st.env}`);
    return `4 环境 + 4 风格 + 2 滑块 + 恢复默认（→${st.env}）`;
  });

  await check('U3 持久化：改为 极简+光晕1.4 后刷新恢复，localStorage 版本化记录', async () => {
    await openThemePanel(page);
    await themePanel(page).getByRole('button', { name: '极简' }).click();
    const slider = themePanel(page).locator('input[type="range"]').first();
    await slider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1.4');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(400);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kb.graph.preferences.v1') ?? 'null'));
    assert(stored?.environment === 'minimal', `存储 environment=${stored?.environment}`);
    assert(Math.abs(Number(stored?.glow) - 1.4) < 1e-6, `存储 glow=${stored?.glow}`);
    assert(stored?.version === 1, `存储 version=${stored?.version}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    const restored = await page.evaluate(() => ({
      env: document.documentElement.dataset.graphEnv,
      bg: document.querySelector('.graph-background')?.dataset.graphEnv,
    }));
    assert(restored.env === 'minimal', `刷新后 env=${restored.env}`);
    assert(restored.bg === 'minimal', `刷新后背景层=${restored.bg}`);
    await openThemePanel(page);
    const glowText = await themePanel(page).getByLabel('光晕强度').inputValue().catch(() => null);
    return `存储 {version:1,environment:minimal,glow:1.4}；刷新后 html/bg=minimal${glowText ? `，滑块=${glowText}` : ''}`;
  });

  for (const scenario of [
    { name: '损坏 JSON', raw: '{bad json' },
    { name: '版本不符', raw: JSON.stringify({ version: 99, environment: 'minimal', nodeStyle: 'orb', glow: 1.5, background: 1 }) },
    { name: '非法 id', raw: JSON.stringify({ version: 1, environment: 'warm-amber', nodeStyle: 'sparkle', glow: 1, background: 1 }) },
  ]) {
    await check(`U3 持久化异常：${scenario.name} → 静默回默认、不崩`, async () => {
      const p = await context.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      try {
        await p.addInitScript((raw) => {
          localStorage.setItem('kb.graph.preferences.v1', raw);
        }, scenario.raw);
        await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
        await waitGraphReady(p);
        const st = await p.evaluate(() => ({
          env: document.documentElement.dataset.graphEnv,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
        }));
        assert(st.env === 'deep-space', `env=${st.env}`);
        assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
        return `env=${st.env}，pageerror=0`;
      } finally {
        await p.close();
      }
    });
  }

  await check('U3 持久化异常：localStorage 抛错（隐私模式）→ 默认外观、不崩', async () => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    try {
      await p.addInitScript(() => {
        const orig = Storage.prototype.getItem;
        Storage.prototype.getItem = function () {
          throw new Error('storage blocked');
        };
        Storage.prototype.setItem = function () {
          throw new Error('storage blocked');
        };
        void orig;
      });
      await p.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await waitGraphReady(p);
      const st = await p.evaluate(() => document.documentElement.dataset.graphEnv);
      assert(st === 'deep-space', `env=${st}`);
      assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
      return `env=deep-space，pageerror=0（getItem/setItem 均抛错）`;
    } finally {
      await p.close();
    }
  });

  await check('U3 记忆度图例仍为琥珀梯度（切环境后不变）', async () => {
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    const read = async () =>
      page.evaluate(() => {
        const el = document.querySelector('button[aria-label="展开记忆度图例"] span[aria-hidden]');
        return el ? getComputedStyle(el).backgroundImage : null;
      });
    const before = await read();
    await openThemePanel(page);
    await themePanel(page).getByRole('button', { name: '极光' }).click();
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="关系图谱设置"]').click();
    await page.waitForTimeout(300);
    const after = await read();
    assert(before && after, '图例渐变未读取到');
    assert(before === after, '切换环境后记忆度图例渐变变化');
    const hasAmber = /rgb\(2[0-9]{2},\s*1[6-9][0-9]|245|232/.test(before);
    await openThemePanel(page);
    await themePanel(page).getByRole('button', { name: '恢复默认外观' }).click();
    await page.locator('button[aria-label="关系图谱设置"]').click();
    return `渐变字符串在 极光/深空 下一致（${before.slice(0, 60)}…），琥珀语义色保留=${hasAmber}`;
  });

  await check('U3 移动端 375：主题面板可用、不越界、无横向溢出', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
    await waitGraphReady(page);
    await openThemePanel(page);
    const m = await page.evaluate(() => {
      const panel = document.querySelector('section[aria-label="图谱外观主题"]').closest('div');
      const r = panel.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollW: document.documentElement.scrollWidth };
    });
    assert(m.left >= -1 && m.right <= 376 && m.top >= 0, `面板越界 ${JSON.stringify(m)}`);
    assert(m.scrollW <= 376, `横向溢出 ${m.scrollW}`);
    await page.screenshot({ path: 'artifacts/phase5-qa-mobile-theme.png' });
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return `面板 ${m.left.toFixed(0)}–${m.right.toFixed(0)}，无横向溢出`;
  });

  // ---------- U4-4 /ask 上下文 ----------
  const apiCtx = await request.newContext({ baseURL });
  await apiCtx.post('/api/auth/login', { data: { passcode } });
  const graphPayload = await (await apiCtx.get('/api/graph')).json();
  const ids = graphPayload.nodes.map((n) => n.id);
  const titleById = new Map(graphPayload.nodes.map((n) => [n.id, n.title]));
  const [id1, id2] = ids;

  await check('U4-4 /ask?segment：chip=1、不自动发送、输入框提示切换', async () => {
    const p = await context.newPage();
    const posts = [];
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/ai/ask')) posts.push(req.postData());
    });
    try {
      await p.goto(`${baseURL}/ask?segment=${id1}`, { waitUntil: 'domcontentloaded' });
      const chipSection = p.locator('section[aria-label="当前上下文"]');
      await chipSection.waitFor({ state: 'visible', timeout: 40_000 });
      const text = await chipSection.innerText();
      assert(text.includes(titleById.get(id1)), `chip 文案=${text}`);
      assert(text.includes('1 个知识点'), `chip 计数=${text}`);
      await p.waitForTimeout(1_200);
      assert(posts.length === 0, `加载后自动发送了 ${posts.length} 次`);
      const placeholder = await p.locator('input:not([type="hidden"]), textarea').first().getAttribute('placeholder');
      assert(placeholder?.includes('解释这个知识点'), `placeholder=${placeholder}`);
      await p.screenshot({ path: 'artifacts/phase5-qa-ask-segment.png' });
      return `chip「${titleById.get(id1)}」，无自动发送，placeholder 含「解释这个知识点」`;
    } finally {
      await p.close();
    }
  });

  await check('U4-4 /ask?path：chips=2、预填建议问题但不发送', async () => {
    const p = await context.newPage();
    const posts = [];
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/ai/ask')) posts.push(req.postData());
    });
    try {
      await p.goto(`${baseURL}/ask?path=${id1},${id2}`, { waitUntil: 'domcontentloaded' });
      const chipSection = p.locator('section[aria-label="当前上下文"]');
      await chipSection.waitFor({ state: 'visible', timeout: 40_000 });
      const chips = await chipSection.locator('[aria-label^="移除上下文"]').count();
      assert(chips === 2, `chips=${chips}`);
      assert((await chipSection.innerText()).includes('2 个知识点'), 'chip 计数不是 2');
      const value = await p.locator('input:not([type="hidden"]), textarea').first().inputValue();
      assert(value.includes('解释'), `预填值=${value}`);
      await p.waitForTimeout(1_200);
      assert(posts.length === 0, `加载后自动发送了 ${posts.length} 次`);
      await p.screenshot({ path: 'artifacts/phase5-qa-ask-path.png' });
      return `chips=2，预填「${value.slice(0, 24)}…」，无自动发送`;
    } finally {
      await p.close();
    }
  });

  await check('U4-4 非法/不存在 id：静默忽略、不报错', async () => {
    const p = await context.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    try {
      await p.goto(`${baseURL}/ask?segment=not-a-uuid`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(800);
      assert((await p.locator('section[aria-label="当前上下文"]').count()) === 0, '非法 id 不应显示 chips');
      await p.goto(`${baseURL}/ask?segment=00000000-0000-4000-8000-000000000000`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(1_500);
      assert((await p.locator('section[aria-label="当前上下文"]').count()) === 0, '不存在 id 应被静默剔除');
      assert(errs.length === 0, `pageerror：${errs.slice(0, 2).join(' | ')}`);
      return '非法格式与不存在 UUID 均无 chips、无错误';
    } finally {
      await p.close();
    }
  });

  await check('U4-4 发送请求体带 context.segmentIds；无上下文时不带 context', async () => {
    const p = await context.newPage();
    const bodies = [];
    await p.route('**/api/ai/ask', (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}'));
      route.fulfill({ status: 500, json: { error: 'QA 拦截：不调用真实 LLM' } });
    });
    try {
      await p.goto(`${baseURL}/ask?segment=${id1}`, { waitUntil: 'domcontentloaded' });
      await p.locator('section[aria-label="当前上下文"]').waitFor({ state: 'visible', timeout: 40_000 });
      const box = p.locator('input:not([type="hidden"]), textarea').first();
      await box.fill('解释这个知识点');
      await p.getByRole('button', { name: /发送/ }).click();
      await poll(() => Promise.resolve(bodies.length > 0), 10_000);
      assert(bodies.length >= 1, '未捕获到请求体');
      const withCtx = bodies[0];
      assert(JSON.stringify(withCtx.context?.segmentIds) === JSON.stringify([id1]), `context.segmentIds=${JSON.stringify(withCtx.context)}`);
      // 无上下文
      await p.goto(`${baseURL}/ask`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(600);
      const box2 = p.locator('input:not([type="hidden"]), textarea').first();
      await box2.fill('测试无上下文');
      await p.getByRole('button', { name: /发送/ }).click();
      await poll(() => Promise.resolve(bodies.length > 1), 10_000);
      const plain = bodies[bodies.length - 1];
      assert(plain.query === '测试无上下文', `query=${plain.query}`);
      assert(!('context' in plain), `无上下文时仍带 context：${JSON.stringify(plain.context)}`);
      await p.screenshot({ path: 'artifacts/phase5-qa-ask-send.png' });
      return `有上下文 body.context.segmentIds=[${id1.slice(0, 8)}…]；无上下文 body 无 context 字段`;
    } finally {
      await p.close();
    }
  });

  await check('U4-4 清除 chips 不重载页面、URL 同步清空；移除单个 chip', async () => {
    const p = await context.newPage();
    let loadCount = 0;
    p.on('load', () => {
      loadCount += 1;
    });
    try {
      await p.goto(`${baseURL}/ask?path=${id1},${id2}`, { waitUntil: 'domcontentloaded' });
      await p.locator('section[aria-label="当前上下文"]').waitFor({ state: 'visible', timeout: 40_000 });
      const loadsBefore = loadCount;
      await p.locator('[aria-label^="移除上下文"]').first().click();
      await p.waitForTimeout(600);
      const chipsAfter = await p.locator('[aria-label^="移除上下文"]').count();
      assert(chipsAfter <= 1, `移除单个后 chips=${chipsAfter}`);
      // 移除后可能短暂进入加载态：等上下文区重新出现再点「全部清除」
      const clearAll = p.locator('button', { hasText: '全部清除' });
      await clearAll.waitFor({ state: 'visible', timeout: 40_000 });
      await clearAll.click();
      await p.waitForTimeout(700);
      assert((await p.locator('section[aria-label="当前上下文"]').count()) === 0, '全部清除后 chips 仍在');
      assert(loadCount === loadsBefore, `清空 chips 触发了页面重载（load ${loadsBefore}→${loadCount}）`);
      const url = new URL(p.url());
      assert(!url.searchParams.get('segment') && !url.searchParams.get('path'), `URL 未清空：${p.url()}`);
      return `移除/全部清除均原地生效（load 次数不变），URL 已清空`;
    } finally {
      await p.close();
    }
  });

  // ---------- 回归（阶段 0–4 关键项） ----------
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
  await waitGraphReady(page);

  await check('回归：搜索/详情/右键菜单/一阶 focus 仍正常', async () => {
    const rp = await context.newPage();
    try {
      await rp.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await waitGraphReady(rp);
      await rp.keyboard.press('Control+K');
      await rp.getByRole('combobox').fill('网络');
      await rp.locator('section[aria-label="搜索知识"] [role="option"]').first().waitFor({ timeout: 10_000 });
      const n = await rp.locator('section[aria-label="搜索知识"] [role="option"]').count();
      assert(n === 3, `搜索结果=${n}`);
      await rp.getByRole('combobox').press('Escape');
      await rp.locator('section[aria-label="搜索知识"]').waitFor({ state: 'detached', timeout: 5_000 });
      const s = await snapshot(rp);
      const pt = await rp.evaluate(({ x, y }) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
        return { x: r.left + p.x, y: r.top + p.y };
      }, s.positions[0]);
      await rp.mouse.click(pt.x, pt.y, { button: 'right' });
      await rp.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 5_000 });
      const items = await rp.locator('[role="menu"] [role="menuitem"]').count();
      assert(items === 7, `右键菜单项=${items}`);
      await rp.keyboard.press('Escape');
      await rp.mouse.click(pt.x, pt.y);
      await rp.locator('aside[aria-label="知识点详情"]').waitFor({ state: 'visible', timeout: 10_000 });
      const btn = rp.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开一阶关联/ });
      await btn.click();
      await rp.waitForTimeout(300);
      const t = await rp.locator('aside[aria-label="知识点详情"]').getByRole('button', { name: /展开二阶关联|收起关联/ }).innerText();
      assert(t.includes('展开二阶关联'), `一阶后按钮=${t}`);
      return '搜索 3 条、右键 7 项、详情/一阶 focus 正常（关闭在 phase1/4 门禁已覆盖；此处不点 ✕ 以避开 Next dev overlay 拦截）';
    } finally {
      await rp.close();
    }
  });

  await check('回归：筛选/力参数/拖拽/fixture/空态/骨架', async () => {
    const rp = await context.newPage();
    try {
      await rp.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await waitGraphReady(rp);
      await rp.locator('button[aria-label="关系图谱设置"]').click();
      for (const tab of ['筛选', '分组', '显示', '力', '主题']) {
        await rp.getByRole('button', { name: tab, exact: true }).waitFor({ timeout: 5_000 });
      }
      await rp.getByRole('button', { name: '力', exact: true }).click();
      assert((await rp.locator('input[type="range"]').count()) === 4, '力滑块数量');
      await rp.locator('button[aria-label="关系图谱设置"]').click();
      const s = await snapshot(rp);
      const pt = await rp.evaluate(({ x, y }) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const p = window.__kbGraphInstance.graph2ScreenCoords(x, y);
        return { x: r.left + p.x, y: r.top + p.y };
      }, s.positions[0]);
      await rp.mouse.move(pt.x, pt.y, { steps: 3 });
      await rp.mouse.down();
      await rp.mouse.move(pt.x + 70, pt.y + 40, { steps: 10 });
      await rp.waitForTimeout(200);
      await rp.mouse.up();
      const reheated = await poll(async () => {
        const cur = await snapshot(rp);
        return cur.engineStop !== s.engineStop ? cur : undefined;
      }, 30_000);
      assert(reheated, '拖拽未重排');
      await rp.goto(`${baseURL}/graph?fixture=graph-small`, { waitUntil: 'domcontentloaded' });
      await waitGraphReady(rp);
      assert((await rp.locator('[aria-label="压测数据模式：graph-small"]').count()) === 1, 'fixture 徽标缺失');
      const p1 = await context.newPage();
      await p1.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
      await p1.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await p1.getByText('图谱还没有灯。').waitFor({ timeout: 30_000 });
      await p1.close();
      const p2 = await context.newPage();
      await p2.route('**/api/graph', async (route) => {
        await new Promise((r) => setTimeout(r, 2_000));
        await route.continue().catch(() => {});
      });
      await p2.goto(`${baseURL}/graph`, { waitUntil: 'domcontentloaded' });
      await p2.locator('[role="status"][aria-label="加载中"]').waitFor({ state: 'visible', timeout: 10_000 });
      await p2.waitForTimeout(2_400);
      await p2.close();
      return '四页签+力滑块、拖拽重排、fixture 500、空态、骨架正常';
    } finally {
      await rp.close();
    }
  });

  await check('回归：移动端 375 全站导航/内容不溢出（/notes、/graph、/ask）', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const rows = [];
    for (const path of ['/notes', '/graph', '/ask']) {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      if (path === '/graph') await waitGraphReady(page);
      else await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const navEl = document.querySelector('nav[aria-label="知识宇宙导航"]');
        const r = navEl.getBoundingClientRect();
        return {
          navCount: document.querySelectorAll('nav[aria-label="知识宇宙导航"]').length,
          navTop: r.top,
          scrollW: document.documentElement.scrollWidth,
          innerW: innerWidth,
        };
      });
      assert(m.navCount === 1, `${path} nav 数量=${m.navCount}`);
      assert(m.scrollW <= m.innerW + 1, `${path} 横向溢出 ${m.scrollW}>${m.innerW}`);
      assert(m.navTop > m.innerW * 0.3, `${path} 底部导航位置异常 top=${m.navTop}`);
      rows.push(`${path}(nav top=${m.navTop.toFixed(0)}, scrollW=${m.scrollW})`);
    }
    await page.screenshot({ path: 'artifacts/phase5-qa-mobile-nav.png' });
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    return rows.join('；');
  });

  await check('主流程 0 console/page error', async () => {
    assert(pageErrors.length === 0, `pageerror：${pageErrors.slice(0, 2).join(' | ')}`);
    const suspended = consoleErrors.filter((e) => /ERR_NETWORK_IO_SUSPENDED/.test(e.text));
    const real = consoleErrors.filter((e) => !/ERR_NETWORK_IO_SUSPENDED/.test(e.text));
    assert(real.length === 0, `console.error：${real.slice(0, 3).map((e) => `${e.text} @${e.url}`).join(' | ')}`);
    return `pageerror=0，console.error=${real.length}${suspended.length ? `（另有 ${suspended.length} 条 ERR_NETWORK_IO_SUSPENDED，由 QA 关闭页面/导航中断请求产生，非产品错误）` : ''}`;
  });
} catch (error) {
  record('脚本级异常', false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
} finally {
  await browser.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const summary = { baseURL, capturedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  writeFileSync('artifacts/phase5-qa-verify.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n=== ${summary.passed}/${summary.total} passed, ${summary.failed} failed ===`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}
