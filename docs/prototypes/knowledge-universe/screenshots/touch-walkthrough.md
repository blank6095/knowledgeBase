# 移动端触控走查（模拟触控 · 非真机）

采集时间：2026-11-06T17:59:09.750Z；页面脚本错误：0

> **边界**：Playwright `hasTouch` + CDP touch 事件模拟，可验证浏览器内可量测的交互事实，**不能替代真实设备**（iOS 安全区、系统手势、浏览器工具栏、滚动惯性、触摸反馈均无法覆盖）。

| 检查项 | 320x720 | 375x667 | 390x844 |
|---|---|---|---|
| Sheet 展开：点击节点后展开，节点选中状态保留 | 通过 | 通过 | 通过 |
| 主操作可用：展开后阅读 / 回忆 / AI 等入口仍可触达 | 通过 | 通过 | 通过 |
| 底层隔离：操作 Sheet 不意外拖动图谱或触发底层节点 | 通过 | 通过 | 通过 |
| 滚动行为：Sheet 内部滚动正常，页面不跟随滚动 | 通过 | 通过 | 通过 |
| 关闭与恢复：关闭后图谱位置与选中 / 搜索上下文保留 | 通过 | 通过 | 通过 |
| 小屏星图：320px 下节点、关系与当前焦点可辨认 | 通过 | 通过 | 通过 |
| 路径探索：浮层关闭后仍能选择第二个节点 | 通过 | 通过 | 通过 |
| 安全区域：底部操作不被工具栏 / 安全区遮挡 | 通过 | 通过 | 通过 |

### 320×720

- **sheet-open**：通过 — Sheet 可见=true；选中节点="记忆新鲜度"；.selected 数=1；面板高度=396px / 视口 720px（占比 55%）
- **primary-actions**：通过 — Sheet 内六项：阅读=可触达、主动回忆=可触达、询问 AI=可触达、关闭=可触达、继续搜索（等价入口）=可触达、返回图谱（等价入口）=可触达；底层主操作（modal 隔离属预期，须有等价入口）：搜索框=被 sheet-toolbar 隔离、模式栏首项=被 overlay-backdrop 隔离、底部导航=被 SPAN 隔离
- **isolation**：通过 — 滑动前/后：主模式 "搜索聚焦" → "搜索聚焦"，选中 "记忆新鲜度" → "记忆新鲜度"
- **scroll**：通过 — 页面 scrollY 0 → 0；Sheet 内 scrollTop 0 → 272（可滚高度 272px）
- **close-restore**：通过 — Sheet 已关闭=true；操作链路生效=true；选中 "记忆新鲜度"；搜索 ""记忆" · 4 命中"；主模式 "搜索聚焦"
- **compact-graph**：通过 — 节点 12 / 关系 18 / 可见标签 1 / 选中光环 2 / 选中节点在视口内=true / 焦点标签可见=true / viewBox=0 0 360 420
- **path-explore**：通过 — 路径端点："间隔重复 → 知识图谱（2/2）"；主模式 "路径探索"；第二节点 tap 点命中=core
- **safe-area**：通过 — maxHeight=396px；paddingBottom=20px；overscroll=contain；页面滚动锁定=true；半屏/全屏切换=true；内容可滚=true；最后按钮 bottom=641.1 / 视口 720

### 375×667

- **sheet-open**：通过 — Sheet 可见=true；选中节点="记忆新鲜度"；.selected 数=1；面板高度=367px / 视口 667px（占比 55%）
- **primary-actions**：通过 — Sheet 内六项：阅读=可触达、主动回忆=可触达、询问 AI=可触达、关闭=可触达、继续搜索（等价入口）=可触达、返回图谱（等价入口）=可触达；底层主操作（modal 隔离属预期，须有等价入口）：搜索框=被 overlay-panel 隔离、模式栏首项=被 overlay-backdrop 隔离、底部导航=被 SPAN 隔离
- **isolation**：通过 — 滑动前/后：主模式 "搜索聚焦" → "搜索聚焦"，选中 "记忆新鲜度" → "记忆新鲜度"
- **scroll**：通过 — 页面 scrollY 0 → 0；Sheet 内 scrollTop 0 → 245（可滚高度 245px）
- **close-restore**：通过 — Sheet 已关闭=true；操作链路生效=true；选中 "记忆新鲜度"；搜索 ""记忆" · 4 命中"；主模式 "搜索聚焦"
- **compact-graph**：通过 — 节点 12 / 关系 18 / 可见标签 1 / 选中光环 2 / 选中节点在视口内=true / 焦点标签可见=true / viewBox=0 0 360 420
- **path-explore**：通过 — 路径端点："间隔重复 → 知识图谱（2/2）"；主模式 "路径探索"；第二节点 tap 点命中=bottom-nav
- **safe-area**：通过 — maxHeight=366.85px；paddingBottom=20px；overscroll=contain；页面滚动锁定=true；半屏/全屏切换=true；内容可滚=true；最后按钮 bottom=587.7 / 视口 667

### 390×844

- **sheet-open**：通过 — Sheet 可见=true；选中节点="记忆新鲜度"；.selected 数=1；面板高度=464px / 视口 844px（占比 55%）
- **primary-actions**：通过 — Sheet 内六项：阅读=可触达、主动回忆=可触达、询问 AI=可触达、关闭=可触达、继续搜索（等价入口）=可触达、返回图谱（等价入口）=可触达；底层主操作（modal 隔离属预期，须有等价入口）：搜索框=被 overlay-panel 隔离、模式栏首项=被 overlay-backdrop 隔离、底部导航=被 SPAN 隔离
- **isolation**：通过 — 滑动前/后：主模式 "搜索聚焦" → "搜索聚焦"，选中 "记忆新鲜度" → "记忆新鲜度"
- **scroll**：通过 — 页面 scrollY 0 → 0；Sheet 内 scrollTop 0 → 148（可滚高度 148px）
- **close-restore**：通过 — Sheet 已关闭=true；操作链路生效=true；选中 "记忆新鲜度"；搜索 ""记忆" · 4 命中"；主模式 "搜索聚焦"
- **compact-graph**：通过 — 节点 12 / 关系 18 / 可见标签 1 / 选中光环 2 / 选中节点在视口内=true / 焦点标签可见=true / viewBox=0 0 360 420
- **path-explore**：通过 — 路径端点："间隔重复 → 知识图谱（2/2）"；主模式 "路径探索"；第二节点 tap 点命中=core
- **safe-area**：通过 — maxHeight=464.2px；paddingBottom=20px；overscroll=contain；页面滚动锁定=true；半屏/全屏切换=true；内容可滚=true；最后按钮 bottom=583.8 / 视口 844

