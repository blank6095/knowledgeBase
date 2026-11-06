/* Knowledge Universe · 三页高保真原型共用逻辑
 * 独立静态原型：模拟数据、无网络请求、无外部依赖、不接业务 API。
 * 交互均真实可操作：搜索聚焦、节点选中、详情浮层、状态切换、返回 / 关闭。
 * 两层状态模型见 docs/执行版任务清单.md §6 表 6。
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // 模拟数据（原型专用；字段类别对齐 /api/graph、/api/stats、/api/learning/today）
  // ------------------------------------------------------------------
  var NODES = [
    { id: 'n1',  title: '间隔重复',     memory: .86, tags: ['学习方法', '记忆'], summary: '按遗忘曲线安排复习间隔，提升长期保持率。', headingPath: '认知科学 / 记忆', doc: '认知科学笔记', degree: 6, hasRecord: true,  due: false, x: .18, y: .30 },
    { id: 'n2',  title: '记忆新鲜度',   memory: .72, tags: ['记忆', '指标'],     summary: '用稳定性与最近回顾时间现算的连续量。',     headingPath: '认知科学 / 记忆', doc: '认知科学笔记', degree: 8, hasRecord: true,  due: true,  x: .34, y: .20 },
    { id: 'n3',  title: '主动回忆',     memory: .64, tags: ['学习方法'],         summary: '先尝试提取，再对照参考答案并自评。',       headingPath: '学习方法 / 练习', doc: '学习方法手册', degree: 7, hasRecord: false, due: true,  x: .48, y: .34 },
    { id: 'n4',  title: '双链笔记',     memory: .91, tags: ['知识管理'],         summary: '用显式链接把知识点组织成网络。',           headingPath: '知识管理 / 链接', doc: '知识管理入门', degree: 5, hasRecord: true,  due: false, x: .63, y: .22 },
    { id: 'n5',  title: '知识图谱',     memory: .55, tags: ['知识管理', '图谱'], summary: '节点与关系构成的可探索空间。',             headingPath: '知识管理 / 图谱', doc: '知识管理入门', degree: 9, hasRecord: false, due: false, x: .78, y: .35 },
    { id: 'n6',  title: '遗忘曲线',     memory: .38, tags: ['记忆'],             summary: '保持率随时间衰减，复习可重置衰减。',       headingPath: '认知科学 / 记忆', doc: '认知科学笔记', degree: 4, hasRecord: false, due: true,  x: .26, y: .62 },
    { id: 'n7',  title: '自评等级',     memory: .70, tags: ['学习方法', '指标'], summary: 'incorrect / partial / correct 三档自评。',  headingPath: '学习方法 / 练习', doc: '学习方法手册', degree: 5, hasRecord: true,  due: false, x: .43, y: .72 },
    { id: 'n8',  title: '检索线索',     memory: .48, tags: ['记忆'],             summary: '提取时的上下文线索影响回忆成功率。',       headingPath: '认知科学 / 提取', doc: '认知科学笔记', degree: 4, hasRecord: false, due: false, x: .60, y: .62 },
    { id: 'n9',  title: '关联路径',     memory: .79, tags: ['图谱'],             summary: '两个知识点之间的最短关系链。',             headingPath: '知识管理 / 图谱', doc: '知识管理入门', degree: 6, hasRecord: true,  due: false, x: .76, y: .70 },
    { id: 'n10', title: '掌握证据',     memory: .33, tags: ['指标'],             summary: '只有真实复习记录才构成可核实的学习证据。', headingPath: '学习方法 / 评估', doc: '学习方法手册', degree: 3, hasRecord: false, due: true,  x: .12, y: .48 },
    { id: 'n11', title: '待复习队列',   memory: .41, tags: ['学习计划'],         summary: '今日推荐条目由学习计划排序产生。',         headingPath: '学习计划 / 今日', doc: '系统说明',     degree: 5, hasRecord: false, due: true,  x: .88, y: .54 },
    { id: 'n12', title: 'AI 协作',      memory: .67, tags: ['AI'],               summary: '基于当前节点上下文给出可确认的建议。',     headingPath: 'AI / 协作',       doc: '系统说明',     degree: 4, hasRecord: true,  due: false, x: .53, y: .50 }
  ];

  var EDGES = [
    ['n1','n2'], ['n1','n6'], ['n2','n3'], ['n2','n12'], ['n3','n7'], ['n3','n12'],
    ['n4','n5'], ['n4','n9'], ['n5','n9'], ['n5','n11'], ['n6','n7'], ['n6','n10'],
    ['n7','n8'], ['n8','n9'], ['n8','n12'], ['n9','n11'], ['n10','n3'], ['n12','n9']
  ];

  // §5 表 4：首页只展示这些「可靠支持」的字段类别，数值为原型模拟值
  var STATS = {
    total: 12,
    byTier: { unread: 2, weak: 3, medium: 4, strong: 3 },
    readToday: 3,
    recentDocuments: [
      { title: '认知科学笔记', at: '今天 09:12' },
      { title: '学习方法手册', at: '昨天 20:40' },
      { title: '知识管理入门', at: '11-02 15:06' }
    ],
    weakTop3: ['间隔重复', '遗忘曲线', '待复习队列'],
    unreadTop3: ['AI 协作', '自评等级', '检索线索'],
    // /api/ai/config 只提供 configured 等状态，不提供建议内容
    aiConfigured: false
  };

  var MODES = [
    { id: 'free',   label: '自由探索' },
    { id: 'search', label: '搜索聚焦' },
    { id: 'path',   label: '路径探索' },
    { id: 'learn',  label: '学习模式' },
    { id: 'ai',     label: 'AI 探索' }
  ];

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var toastTimer = null;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    if (text != null) node.textContent = text;
    return node;
  }
  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function byId(id) { return document.getElementById(id); }
  function nodeById(id) { for (var i = 0; i < NODES.length; i++) if (NODES[i].id === id) return NODES[i]; return null; }
  function parseHex(hex) {
    var h = hex.replace('#', '');
    var f = h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h;
    var n = parseInt(f, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** 亮度只由 memory 驱动；函数不接收搜索上下文，保证「搜索不得覆盖记忆亮度」。 */
  function encodeBrightness(memory) { return 0.35 + 0.65 * (Number.isFinite(memory) ? Math.min(1, Math.max(0, memory)) : 0); }
  function brightnessColor(base, brightness) {
    var c = parseHex(base), s = Math.min(1, Math.max(0, brightness));
    return 'rgb(' + c.map(function (v) { return Math.round(v * s + 255 * (1 - s) * 0.12); }).join(',') + ')';
  }
  function memoryLabel(m) { return m >= .75 ? '牢固' : m >= .4 ? '中等' : '薄弱'; }

  // ------------------------------------------------------------------
  // 公共 chrome：顶栏 / 状态切换 / 底部导航 / 更多抽屉 / toast / aria-live
  // ------------------------------------------------------------------
  function mountChrome(activePage) {
    var root = byId('ku-chrome');
    if (!root) return;

    var top = el('header', { class: 'topbar' });
    var brand = el('div', { class: 'brand' });
    brand.appendChild(el('span', { class: 'brand-mark', 'aria-hidden': 'true' }));
    var brandText = el('div', {}, 'Knowledge Universe');
    brandText.appendChild(el('small', {}, '沉浸式知识宇宙 · 视觉原型'));
    brand.appendChild(brandText);
    top.appendChild(brand);
    top.appendChild(el('span', { class: 'proto-badge' }, '原型 · 模拟数据'));
    top.appendChild(el('div', { class: 'topbar-spacer' }));

    var sw = el('div', { class: 'state-switch', role: 'group', 'aria-label': '数据状态切换' });
    sw.appendChild(el('span', {}, '状态'));
    [['normal', '正常'], ['empty', '空数据'], ['loading', '加载中'], ['error', '错误']].forEach(function (pair) {
      var b = el('button', {
        type: 'button', 'data-statemode': pair[0], 'aria-pressed': pair[0] === 'normal' ? 'true' : 'false'
      }, pair[1]);
      b.addEventListener('click', function () { setDataMode(pair[0]); });
      sw.appendChild(b);
    });
    top.appendChild(sw);
    root.appendChild(top);

    var nav = el('nav', { class: 'bottom-nav', 'aria-label': '主导航' });
    [
      { id: 'home', href: 'home.html', ico: '◉', label: '首页' },
      { id: 'graph', href: 'graph.html', ico: '✧', label: '图谱' },
      { id: 'detail', href: 'detail.html', ico: '◈', label: '知识详情' }
    ].forEach(function (item) {
      var a = el('a', { href: item.href, class: activePage === item.id ? 'active' : '', 'aria-current': activePage === item.id ? 'page' : null });
      a.appendChild(el('span', { class: 'nav-ico', 'aria-hidden': 'true' }, item.ico));
      a.appendChild(el('span', {}, item.label));
      nav.appendChild(a);
    });
    var more = el('button', { type: 'button', id: 'ku-more', 'aria-label': '更多入口', 'aria-expanded': 'false' });
    more.appendChild(el('span', { class: 'nav-ico', 'aria-hidden': 'true' }, '⋯'));
    more.appendChild(el('span', {}, '更多'));
    more.addEventListener('click', function () { toggleDrawer(true); });
    nav.appendChild(more);
    root.appendChild(nav);

    var drawer = el('div', { class: 'drawer', id: 'ku-drawer', hidden: 'hidden', role: 'dialog', 'aria-label': '更多入口' });
    var sheet = el('div', { class: 'drawer-sheet' });
    sheet.appendChild(el('h3', {}, '更多入口（原型）'));
    [
      ['原型索引', 'index.html'],
      ['设计规范与令牌', '../../设计规范与令牌.md'],
      ['移动端适配方案', '../../移动端适配方案.md'],
      ['T07 评审材料', '../../T07评审材料.md']
    ].forEach(function (p) { sheet.appendChild(el('a', { href: p[1] }, p[0])); });
    var close = el('button', { type: 'button' }, '关闭');
    close.addEventListener('click', function () { toggleDrawer(false); });
    sheet.appendChild(close);
    drawer.appendChild(sheet);
    drawer.addEventListener('click', function (e) { if (e.target === drawer) toggleDrawer(false); });
    root.appendChild(drawer);

    root.appendChild(el('div', { class: 'toast', id: 'ku-toast', role: 'status', hidden: 'hidden' }));
    root.appendChild(el('div', { class: 'sr-only', id: 'ku-live', 'aria-live': 'polite' }));

    document.body.setAttribute('data-mode', 'normal');
  }

  function toggleDrawer(open) {
    var d = byId('ku-drawer');
    if (!d) return;
    if (open) d.removeAttribute('hidden'); else d.setAttribute('hidden', 'hidden');
    var btn = byId('ku-more');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function announce(msg) {
    var live = byId('ku-live');
    if (live) live.textContent = msg;
  }
  function toast(msg) {
    var t = byId('ku-toast');
    if (!t) return;
    t.textContent = msg;
    t.removeAttribute('hidden');
    announce(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.setAttribute('hidden', 'hidden'); }, 2200);
  }

  function setDataMode(mode) {
    document.body.setAttribute('data-mode', mode);
    var buttons = document.querySelectorAll('[data-statemode]');
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-statemode') === mode ? 'true' : 'false');
      if (b.getAttribute('data-statemode') === mode) b.classList.add('active');
      else b.classList.remove('active');
    });
    var panel = byId('ku-state-panel');
    if (panel) {
      var content = statePanelHtml(mode);
      panel.innerHTML = content;
      panel.hidden = mode === 'normal';
      if (mode !== 'normal') {
        var retry = panel.querySelector('[data-retry]');
        if (retry) retry.addEventListener('click', function () { setDataMode('normal'); toast('已恢复到正常状态'); });
      }
    }
    window.dispatchEvent(new CustomEvent('ku:datamode', { detail: { mode: mode } }));
  }

  function statePanelHtml(mode) {
    if (mode === 'empty') {
      return '<div class="state-block"><span class="icon" aria-hidden="true">◇</span>' +
        '<b>这里还没有内容</b><p class="muted tiny">空数据状态：不显示虚构数字，只给出可进行的下一步。</p>' +
        '<button type="button" data-retry>载入示例数据</button></div>';
    }
    if (mode === 'loading') {
      return '<div class="state-block"><span class="spinner" aria-hidden="true"></span>' +
        '<b>正在构建你的知识宇宙</b><p class="muted tiny">加载中状态：主内容区保留骨架，不出现跳动布局。</p>' +
        '<button type="button" data-retry>完成加载</button></div>';
    }
    if (mode === 'error') {
      return '<div class="state-block"><span class="icon" aria-hidden="true">⚠</span>' +
        '<b>内容加载失败</b><p class="muted tiny">错误态：说明原因并提供重试，不把错误藏成空白。</p>' +
        '<button type="button" data-retry>重新加载</button></div>';
    }
    return '';
  }

  // ------------------------------------------------------------------
  // SVG 图谱渲染（首页缩略图与图谱页共用）
  // ------------------------------------------------------------------
  function searchMatches(query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return [];
    // 表 2 硬边界：只检索 title / tags / headingPath / summary
    return NODES.filter(function (n) {
      return [n.title, (n.tags || []).join(' '), n.headingPath, n.summary]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    }).map(function (n) { return n.id; });
  }

  /**
   * opts: { selectedId, query, matchedIds, pathEndpoints, interactive, showLabels, onNode }
   * 视觉编码：亮度=memory；透明度=搜索匹配；外环=真实学习记录；标记=待复习；光环=选中。
   */
  function renderGraph(svg, opts) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // 移动端独立布局：小屏切换为 3×4 紧凑星图，避免把桌面画布等比缩小到看不清
    var measured = svg.getBoundingClientRect().width || svg.clientWidth || 1000;
    var compact = measured > 0 && measured < 600;
    var vbW = compact ? 360 : 1000;
    var vbH = compact ? 420 : 460;
    svg.setAttribute('viewBox', '0 0 ' + vbW + ' ' + vbH);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '知识宇宙图谱，共 ' + NODES.length + ' 个模拟知识点，' + (compact ? '移动紧凑布局' : '桌面布局'));

    var selectedId = opts.selectedId || null;
    var matched = opts.matchedIds || [];
    var hasQuery = Boolean(opts.query);
    var matchedSet = {};
    matched.forEach(function (id) { matchedSet[id] = true; });
    var endpoints = opts.pathEndpoints || [];
    var endpointSet = {};
    endpoints.forEach(function (id) { endpointSet[id] = true; });
    var pos = {};
    if (compact) {
      var cols = 3, rows = 4;
      NODES.forEach(function (n, i) {
        var c = i % cols, r = Math.floor(i / cols);
        pos[n.id] = {
          x: (c + .5) * (vbW / cols) + (i % 2 ? 7 : -7),
          y: (r + .5) * (vbH / rows) + (i % 3 ? 5 : -5)
        };
      });
    } else {
      NODES.forEach(function (n) { pos[n.id] = { x: n.x * 1000, y: n.y * 460 }; });
    }

    var gEdges = svgEl('g', { 'aria-hidden': 'true' });
    EDGES.forEach(function (pair) {
      var a = pos[pair[0]], b = pos[pair[1]];
      if (!a || !b) return;
      var strong = (hasQuery && matchedSet[pair[0]] && matchedSet[pair[1]]) ||
        (endpoints.length > 0 && (endpointSet[pair[0]] || endpointSet[pair[1]]));
      gEdges.appendChild(svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: 'ku-edge' + (strong ? ' strong' : '')
      }));
    });
    svg.appendChild(gEdges);

    var gNodes = svgEl('g', {});
    NODES.forEach(function (n) {
      var p = pos[n.id];
      var r = compact ? 8 + Math.sqrt(n.degree) * 2.4 : 6 + Math.sqrt(n.degree) * 2.2;
      var g = svgEl('g', {
        class: 'ku-node' + (hasQuery && !matchedSet[n.id] ? ' dim' : '') + (n.id === selectedId ? ' selected' : ''),
        'data-node': n.id,
        role: 'button', tabindex: '0',
        'aria-label': n.title + '，记忆' + memoryLabel(n.memory) +
          (n.hasRecord ? '，有学习记录' : '') + (n.due ? '，待复习' : '')
      });
      // 隐形命中热区：桌面 48 viewBox 单位，移动紧凑布局 64 单位（缩放后约 44 CSS px）
      g.appendChild(svgEl('circle', { class: 'hit', cx: p.x, cy: p.y, r: compact ? 34 : 30 }));
      if (n.hasRecord) g.appendChild(svgEl('circle', { class: 'ring', cx: p.x, cy: p.y, r: r + 4 }));
      if (n.due) g.appendChild(svgEl('circle', { class: 'marker', cx: p.x + r + 2, cy: p.y - r - 2, r: 2.6 }));
      if (n.id === selectedId) {
        g.appendChild(svgEl('circle', { class: 'halo', cx: p.x, cy: p.y, r: r + 5 }));
        g.appendChild(svgEl('circle', { class: 'halo', cx: p.x, cy: p.y, r: r + 9 }));
      }
      g.appendChild(svgEl('circle', {
        class: 'core', cx: p.x, cy: p.y, r: r,
        fill: brightnessColor('#75A7FF', encodeBrightness(n.memory))
      }));
      if (opts.showLabels !== false && (!compact || n.id === selectedId) && (!hasQuery || matchedSet[n.id] || n.id === selectedId)) {
        g.appendChild(svgEl('text', { class: 'label', x: p.x, y: p.y - r - 9 }, n.title));
      }
      if (opts.interactive) {
        g.addEventListener('click', function (e) { e.stopPropagation(); opts.onNode(n.id); });
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onNode(n.id); }
        });
      }
      gNodes.appendChild(g);
    });
    svg.appendChild(gNodes);
  }

  function legendHtml() {
    return '<div class="legend">' +
      '<span><i style="background:#75A7FF"></i>亮度＝记忆新鲜度（不被搜索覆盖）</span>' +
      '<span><i style="background:rgba(117,167,255,.25)"></i>透明度＝搜索匹配</span>' +
      '<span><i style="border:2px solid #64D9C2;background:transparent"></i>青色外环＝有学习记录（DEC-01 待评审 · 示意）</span>' +
      '<span><i style="background:#F3BB72"></i>橙色标记＝待复习（DEC-01 待评审 · 示意）</span>' +
      '<span><i style="border:2px solid #75A7FF;background:transparent"></i>双层光环＝当前选中</span>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // 浮层：详情 / AI / 学习舱
  // ------------------------------------------------------------------
  function isMobileSheet() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px)').matches;
  }

  /** 移动端 Sheet 顶部工具行：半屏 / 全屏切换 + 不困住用户的两个等价主操作。 */
  function sheetToolbarHtml() {
    return '<div class="sheet-toolbar" role="group" aria-label="浮层工具行">' +
      '<button type="button" data-sheet-toggle aria-expanded="false">展开全屏</button>' +
      '<button type="button" data-action="sheet-search">继续搜索</button>' +
      '<button type="button" data-action="sheet-back">返回图谱</button>' +
      '</div>';
  }

  function openOverlay(backdropId, type, renderFn) {
    var back = byId(backdropId);
    if (!back) return;
    var panel = back.querySelector('.overlay-panel');
    panel.classList.remove('expanded');
    panel.innerHTML = renderFn();
    var mobile = isMobileSheet();
    if (mobile) {
      panel.insertAdjacentHTML('afterbegin', sheetToolbarHtml());
      // 主操作区提到工具行之后、信息区之前：半屏 Sheet 下无需滚动即可触达
      var toolbar = panel.querySelector('.sheet-toolbar');
      var primaryRow = panel.querySelector('.overlay-actions.sheet-primary');
      if (toolbar && primaryRow) toolbar.after(primaryRow);
      document.body.classList.add('sheet-open'); // 锁页面滚动，避免 Sheet 手势带动底层
    }
    back.removeAttribute('hidden');
    var close = panel.querySelector('[data-close]');
    if (close) close.addEventListener('click', function () { closeOverlay(backdropId); });

    var toggle = panel.querySelector('[data-sheet-toggle]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var expanded = panel.classList.toggle('expanded');
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.textContent = expanded ? '收回半屏' : '展开全屏';
      });
    }

    var actions = panel.querySelectorAll('[data-action]');
    Array.prototype.forEach.call(actions, function (a) {
      a.addEventListener('click', function () {
        var action = a.getAttribute('data-action');
        // 两个等价主操作由内核本地处理，页面无需改动，且关闭后上下文照常保留
        if (action === 'sheet-search') {
          closeOverlay(backdropId);
          var input = byId('ku-search');
          if (input) input.focus();
          return;
        }
        if (action === 'sheet-back') { closeOverlay(backdropId); return; }
        window.KU.onOverlayAction(action, a.getAttribute('data-value') || '');
      });
    });
    var focusTarget = panel.querySelector('[data-close]') || panel.querySelector('button') || panel;
    if (focusTarget.focus) focusTarget.focus();
    window.__kuOverlayType = type;
  }

  function closeOverlay(backdropId) {
    var back = byId(backdropId || 'ku-overlay');
    if (!back) return;
    back.setAttribute('hidden', 'hidden');
    document.body.classList.remove('sheet-open');
    window.__kuOverlayType = null;
    window.dispatchEvent(new CustomEvent('ku:overlayclose'));
  }

  function detailPanelHtml(n) {
    var rel = EDGES.filter(function (e) { return e[0] === n.id || e[1] === n.id; })
      .map(function (e) { return nodeById(e[0] === n.id ? e[1] : e[0]); })
      .filter(Boolean).slice(0, 4).map(function (r) { return esc(r.title); }).join('、');
    return '<div class="overlay-head"><h2>' + esc(n.title) + '</h2>' +
      '<button type="button" class="overlay-close" data-close aria-label="关闭详情">✕</button></div>' +
      '<p class="muted tiny">空间浮层 · 信息区 7 项 + 操作区 3 项（点空白 / Esc 关闭）</p>' +
      '<div class="info-list">' +
      '<div class="info-row"><span>名称</span><b>' + esc(n.title) + '</b></div>' +
      '<div class="info-row"><span>所属文档</span><b>' + esc(n.doc) + '</b></div>' +
      '<div class="info-row"><span>标签</span><b>' + n.tags.map(esc).join('、') + '</b></div>' +
      '<div class="info-row"><span>摘要</span><b>' + esc(n.summary) + '</b></div>' +
      '<div class="info-row"><span>记忆状态</span><b>' + memoryLabel(n.memory) + '（' + n.memory.toFixed(2) + '）</b></div>' +
      '<div class="info-row"><span>关联节点</span><b>' + (rel || '暂无') + '</b></div>' +
      '<div class="info-row"><span>最近学习</span><b>' + (n.hasRecord ? '有真实复习记录（非「已掌握」结论）' : '暂无复习记录') + '</b></div>' +
      '</div>' +
      '<div class="divider"></div><p class="field-label">操作区</p>' +
      '<div class="overlay-actions sheet-primary">' +
      '<button type="button" data-action="read" data-value="' + n.id + '">阅读</button>' +
      '<button type="button" data-action="recall" data-value="' + n.id + '">主动回忆</button>' +
      '<button type="button" data-action="ai" data-value="' + n.id + '">询问 AI</button>' +
      '</div>' +
      '<div class="overlay-actions">' +
      '<button type="button" class="ghost" data-action="edit" data-value="' + n.id + '">编辑（辅助）</button>' +
      '<button type="button" class="ghost" data-action="relations" data-value="' + n.id + '">查看完整关系（辅助）</button>' +
      '</div>' +
      '<p class="overlay-note">DEC-01 待评审：青色外环 / 橙色标记在原型中为示意，不代表最终去留结论。</p>';
  }

  function aiPanelHtml(n) {
    return '<div class="overlay-head"><h2>AI 探索 · ' + (n ? esc(n.title) : '未选中节点') + '</h2>' +
      '<button type="button" class="overlay-close" data-close aria-label="关闭 AI 浮层">✕</button></div>' +
      '<p class="muted tiny">上下文仅来自当前节点及已检索关联；一次性候选建议，不持久化、不自动写库。</p>' +
      '<div class="ai-note" style="margin-top:12px">当前节点：' + (n ? esc(n.title) : '—') + '　｜　已检索关联：' +
      (n ? EDGES.filter(function (e) { return e[0] === n.id || e[1] === n.id; }).length : 0) + ' 条</div>' +
      '<div class="info-list" style="margin-top:12px">' +
      '<div class="info-row"><span>事实</span><b>该节点存在 ' + (n ? n.degree : 0) + ' 条已记录关系。</b></div>' +
      '<div class="info-row"><span>推测</span><b>「未检索到关联」不等于「确实缺少关联」。</b></div>' +
      '<div class="info-row"><span>建议</span><b>可对当前节点生成一次回忆问题（需你确认后执行）。</b></div>' +
      '</div>' +
      '<div class="overlay-actions sheet-primary">' +
      '<button type="button" data-action="ai-explain">解释知识点</button>' +
      '<button type="button" data-action="ai-relations">查关联</button>' +
      '<button type="button" data-action="ai-question">生成回忆问题</button>' +
      '</div>' +
      '<p class="overlay-note">AI 不可用或失败时，原有知识库功能保持可用。</p>';
  }

  function learnPanelHtml(n) {
    return '<div class="overlay-head"><h2>专注学习舱 · ' + (n ? esc(n.title) : '待选择') + '</h2>' +
      '<button type="button" class="overlay-close" data-close aria-label="退出学习舱">✕</button></div>' +
      '<p class="muted tiny">七步流程：标题 → 问题 → 作答 → 参考答案 → 自评 → 结果 → 返回图谱。此处只呈现入口与返回路径。</p>' +
      '<div class="state-block" style="margin-top:12px"><span class="icon" aria-hidden="true">◎</span>' +
      '<b>单一焦点，不出现复杂图谱</b><p class="muted tiny">退出后回到进入前主模式，并保留选中节点与搜索上下文。</p></div>' +
      '<div class="overlay-actions sheet-primary"><button type="button" class="primary" data-action="learn-back">完成并返回图谱</button></div>';
  }

  // ------------------------------------------------------------------
  // 全局键盘：Esc / Ctrl+K / 斜杠聚焦搜索
  // ------------------------------------------------------------------
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        toggleDrawer(false);
        var back = byId('ku-overlay');
        if (back && !back.hasAttribute('hidden')) { closeOverlay('ku-overlay'); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toast('全局检索入口（原型：使用页面内搜索框）');
      }
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
        var input = byId('ku-search');
        if (input) { e.preventDefault(); input.focus(); }
      }
    });
  }

  // ------------------------------------------------------------------
  // 公共 API
  // ------------------------------------------------------------------
  window.KU = {
    NODES: NODES,
    EDGES: EDGES,
    STATS: STATS,
    MODES: MODES,
    el: el,
    esc: esc,
    byId: byId,
    nodeById: nodeById,
    memoryLabel: memoryLabel,
    encodeBrightness: encodeBrightness,
    searchMatches: searchMatches,
    renderGraph: renderGraph,
    legendHtml: legendHtml,
    mountChrome: mountChrome,
    setDataMode: setDataMode,
    toast: toast,
    announce: announce,
    toggleDrawer: toggleDrawer,
    openOverlay: openOverlay,
    closeOverlay: closeOverlay,
    detailPanelHtml: detailPanelHtml,
    aiPanelHtml: aiPanelHtml,
    learnPanelHtml: learnPanelHtml,
    bindKeys: bindKeys,
    onOverlayAction: function (action) { toast('原型动作：' + action); }
  };
})();
