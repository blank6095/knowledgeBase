/**
 * remark 插件：把正文里的 `[[标题]]` / `[[标题|别名]]` 转成链接节点。
 *
 * 关键约束：链接节点的**文本仍是原文**（含 `[[` `]]`），展示层再用 CSS 隐藏括号。
 * 原因：批注锚点按 `.md-body` 的 textContent 偏移定位（见 src/lib/highlight.ts），
 * 若渲染时删掉括号，textContent 变短会让所有既有批注错位。
 *
 * 只处理普通文本节点，跳过已有链接、行内代码与代码块。
 */
import { WIKI_LINK_PATTERN } from '@/lib/wikilink';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
}

const SKIP_TYPES = new Set(['link', 'inlineCode', 'code', 'html']);

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  WIKI_LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WIKI_LINK_PATTERN.exec(value))) {
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    const title = match[1].trim();
    if (title) {
      out.push({
        type: 'link',
        // 用自定义协议承载目标标题，渲染层再解析成真实路由或断链
        url: `wiki:${encodeURIComponent(title)}`,
        title: null,
        children: [{ type: 'text', value: match[0] }],
      });
    } else {
      out.push({ type: 'text', value: match[0] });
    }
    last = match.index + match[0].length;
  }

  if (out.length === 0) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function transform(node: MdNode): void {
  if (!node.children || node.children.length === 0) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('[[')) {
      next.push(...splitText(child.value));
      continue;
    }
    if (!SKIP_TYPES.has(child.type)) transform(child);
    next.push(child);
  }
  node.children = next;
}

export default function remarkWikiLink() {
  return (tree: unknown) => {
    transform(tree as MdNode);
  };
}
