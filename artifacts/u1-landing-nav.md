# U1-1 登录直达图谱 + UQ2 全站窄导航（Lead 实现侧验收）

> 采集：2026-10-30 22:20（Asia/Shanghai），dev `http://localhost:3000`，Chrome 1440×1000 / 375×812。
> 脚本：`artifacts/verify-phase3.mjs`；机器可读：`artifacts/phase3-lead-verify.json`。

## U1-1（UQ1/UQ3：直接进入 graph）

- `safeNextPath` 默认值由 `/` 改为 `/graph`（含非法 next、站外 URL、空值）。
- 未登录访问 `/` / `/notes` → `/login?next=…`；登录后回 `next`；无 next → **`/graph`**。
- 实测：从 `/login` 登录后 URL = `http://localhost:3000/graph`。
- `/` 本身保留为「今日学习」页，不做硬跳转（避免破坏既有今日学习入口）。

## UQ2（全站替换侧边栏）

- `AppShell.tsx` 删除旧 `<aside>` / 移动抽屉 / 移动 header / 旧 NAV，改为全站渲染 `GraphNavigation`：
  桌面左侧居中 56px 悬浮窄栏，移动底部条；`/login` 不渲染；`/graph` 仍由页面自渲染（唯一 nav）。
- 全局入口：知识宇宙 `/graph`、知识库 `/notes`、今日学习 `/`、学习复盘 `/progress`、AI 助手 `/ask`、外观主题（disabled，提示「进入知识宇宙后调整」）、设置 `/settings`、退出登录。
- 内容区：非沉浸页 `md:pl-24` + 移动 `pb-24`；主列 `flex-1` 把页脚压到底部。
- 实测 `/notes`：唯一 nav（1 个）、旧 aside 0 个、无横向溢出；nav 矩形 x=12 宽 56，内容从 96px 起；页脚 top=957（视口 1000）。
- 移动 375×812 `/notes`：底部 nav 12..363、宽 351，无横向溢出。
- `/graph`：唯一 nav、6 个图标项 + 退出登录；外观主题项改为打开主题面板。

## 回归

- e2e 6/6（含登录非法 next 断言更新为落到 `/graph`，属产品决策变更）。
- typecheck / lint / test（317）/ build 通过（完整门禁见 phase3-lead-verify / QA 报告）。
