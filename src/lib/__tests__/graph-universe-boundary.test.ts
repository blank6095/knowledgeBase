import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 知识宇宙内核（src/lib/graph/universe/）的边界守卫。
 *
 * 背景：该内核在 docs/执行版任务清单.md §9.4 登记为「交付范围：8 个模块 + 3 个测试文件」，
 * 并明确「接线状态：未接入任何业务页面，未 import 现有业务模块，未改 API / DB / 核心计算」。
 * 同时 §9.3 的 DEC-01（掌握证据外环 / 待复习标记的去留）仍处「待评审」，
 * 结论必须由 T02 评审给出，执行 Agent 不得自行决定内核的存废。
 *
 * 因此本次重构不归档、不删除、不扩展该内核，只把上述既有约束**用测试钉死**：
 * 1. 内核保持纯逻辑（无 React 组件、无第三方包、无业务模块依赖）——一旦被拖入
 *    drizzle-orm / react / @/db 之类，就会在 src/lib 与 src/app 之间形成新的反向依赖边，
 *    也让「未接线即可安全评审」的前提失效；
 * 2. 内核保持未接线——业务侧不得引用它，T08–T14 正式接线时需同步放开本断言。
 *
 * 本文件只做静态文本扫描，不执行内核逻辑（内核行为由 universe-*.test.ts 覆盖）。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UNIVERSE_DIR = join(ROOT, 'src/lib/graph/universe');
const BUSINESS_ROOTS = [join(ROOT, 'src/app'), join(ROOT, 'src/components')];

/** 收集目录下所有 .ts/.tsx 文件（排除 __tests__ 与声明文件）。 */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...collectFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** 去掉注释，避免注释里的 from '...' 被当成真实 import。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

/** 提取模块说明符：静态 import / export-from / 动态 import() / require()。 */
function moduleSpecifiers(source: string): string[] {
  const cleaned = stripComments(source);
  const specs: string[] = [];
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) specs.push(m[1]);
  return specs;
}

describe('universe 内核：边界守卫', () => {
  const universeFiles = collectFiles(UNIVERSE_DIR);
  const relativePath = (file: string): string => file.slice(ROOT.length).replace(/\\/g, '/');

  it('内核目录存在且只含 .ts 模块（纯逻辑，无 React 组件）', () => {
    expect(universeFiles.length).toBeGreaterThan(0);
    const reactFiles = universeFiles.filter((f) => f.endsWith('.tsx'));
    expect(reactFiles.map(relativePath)).toEqual([]);
  });

  it('内核只 import 同目录相对模块，不引入业务模块与第三方包', () => {
    const violations: string[] = [];
    for (const file of universeFiles) {
      for (const spec of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('./')) {
          // 同目录相对导入：目标必须真实存在，避免拼写错误引入悬空引用
          const stem = join(UNIVERSE_DIR, spec.slice(2));
          const candidates = [`${stem}.ts`, join(stem, 'index.ts')];
          if (!candidates.some((c) => exists(c))) {
            violations.push(`${relativePath(file)} → '${spec}'（目标不存在）`);
          }
          continue;
        }
        violations.push(`${relativePath(file)} → '${spec}'（非同目录相对导入）`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('内核未接入业务页面：src/app 与 src/components 不引用 universe', () => {
    const hits: string[] = [];
    for (const base of BUSINESS_ROOTS) {
      for (const file of collectFiles(base)) {
        if (moduleSpecifiers(readFileSync(file, 'utf8')).some((s) => s.includes('graph/universe'))) {
          hits.push(relativePath(file));
        }
      }
    }
    // 接线期（T08–T14）需同步删除本断言。
    expect(hits).toEqual([]);
  });
});
