import { load as loadYaml } from 'js-yaml';

export interface Frontmatter {
  title?: string;
  tags: string[];
  data: Record<string, unknown>;
}

const EMPTY_FM: Frontmatter = { tags: [], data: {} };

/** 解析 YAML frontmatter（--- 包裹的文件头），解析失败时按无 frontmatter 处理 */
export function parseFrontmatter(md: string): { fm: Frontmatter; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: EMPTY_FM, body: md };
  try {
    const data = loadYaml(m[1]) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return { fm: EMPTY_FM, body: md.slice(m[0].length) };
    const tags = normalizeTags(data.tags);
    return {
      fm: { title: typeof data.title === 'string' ? data.title : undefined, tags, data },
      body: md.slice(m[0].length),
    };
  } catch {
    return { fm: EMPTY_FM, body: md };
  }
}

function normalizeTags(v: unknown): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim().replace(/^#/, '');
    if (t && !out.includes(t)) out.push(t);
  };
  if (typeof v === 'string') v.split(/[,,，]/).forEach((s) => push(s));
  if (Array.isArray(v)) v.forEach((s) => typeof s === 'string' && push(s));
  return out;
}

/** 行内 #标签（排除 Markdown 标题：# 后必须直接跟非空内容且前面是行首空白或行中空白） */
export function extractInlineTags(body: string): string[] {
  const tags: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      const token = marker[1];
      if (!fence) fence = { char: token[0], length: token.length };
      else if (token[0] === fence.char && token.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    for (const m of line.matchAll(/(?:^|[\s(（])#([^\s#。，,.!?！？:：;；)）]{1,30})/g)) {
      const t = m[1];
      if (!tags.includes(t)) tags.push(t);
    }
  }
  return tags;
}

/** [[双链目标]]，支持 [[目标|别名]] 形式，返回去重后的目标名 */
export function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 去掉 Markdown 语法符号，用于标题匹配与预览 */
export function stripMarkdown(s: string): string {
  return s
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]+/g, '')
    .trim();
}
