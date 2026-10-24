<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 提示词生成规范（用户指示）

当用户要求生成或优化提示词时，必须基于项目实际情况编写：

1. 动笔前先勘察：用 Read/grep 核实与需求相关的代码（src/）、文档（docs/、README）、脚本（scripts/）与依赖版本；勘察范围与需求触达面成正比，不做无关的全仓扫描。
2. 提示词须包含「项目事实」区块：文件路径（必要时含行号）、接口字段、现有约定与已知坑点，全部来自当轮核实，禁止凭记忆或想象编写。
3. 约束与验收标准必须落到本仓库的具体命令、页面、数据（如 npm run build、/graph?fixture=graph-small）。
4. 先输出勘察结论（发现 → 对提示词的影响），再输出提示词本体。
5. 无法核实的信息显式标注为「假设」，不得与核实事实混排。
