/**
 * `[[双链]]` 解析与标题索引（P0 内链渲染的基础，纯函数可单测）。
 *
 * 语法：`[[标题]]` 或 `[[标题|别名]]`。
 * 注意：标题匹配大小写不敏感；同名标题可能出现在多个文档，解析时优先同文档，
 * 其次唯一匹配，多匹配时标记 ambiguous（UI 上提示但仍给第一个候选，避免死路）。
 */

/** 全局匹配 `[[标题]]` / `[[标题|别名]]`；标题内不允许出现 `]`、`|` */
export const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

export interface WikiLinkParts {
  /** 完整原文，例如 `[[索引|目录]]` */
  raw: string;
  title: string;
  /** `|` 后的别名，未写则为 null */
  alias: string | null;
  /** 展示文案：有别名用别名，否则用标题 */
  display: string;
}

/** 解析单个 `[[...]]`；不匹配返回 null（调用方按普通文本处理） */
export function parseWikiLink(raw: string): WikiLinkParts | null {
  const match = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(raw.trim());
  if (!match) return null;
  const title = match[1].trim();
  if (!title) return null;
  const alias = match[2]?.trim() ? match[2].trim() : null;
  return { raw: raw.trim(), title, alias, display: alias ?? title };
}

export interface WikiTarget {
  segmentId: string;
  title: string;
  documentTitle?: string | null;
}

/** 标题（小写）→ 候选目标；同名多文档时保留全部候选 */
export type WikiIndex = Map<string, WikiTarget[]>;

export function buildWikiIndex(
  nodes: readonly { id: string; title: string; documentTitle?: string | null }[],
): WikiIndex {
  const index: WikiIndex = new Map();
  for (const node of nodes) {
    const key = (node.title ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = index.get(key);
    const target: WikiTarget = {
      segmentId: node.id,
      title: node.title,
      documentTitle: node.documentTitle ?? null,
    };
    if (list) list.push(target);
    else index.set(key, [target]);
  }
  return index;
}

export type WikiResolution =
  | { status: 'resolved'; target: WikiTarget; ambiguous: boolean }
  | { status: 'missing' };

/**
 * 解析标题到具体知识点：
 * 1) 同文档优先（documentTitle 相同）；
 * 2) 否则取唯一候选；
 * 3) 多候选时取 id 最小者并标记 ambiguous，避免断链式死路。
 */
export function resolveWikiTarget(
  index: WikiIndex,
  title: string,
  currentDocumentTitle?: string | null,
): WikiResolution {
  const candidates = index.get(title.trim().toLowerCase());
  if (!candidates || candidates.length === 0) return { status: 'missing' };
  if (currentDocumentTitle) {
    const sameDoc = candidates.filter((c) => c.documentTitle === currentDocumentTitle);
    if (sameDoc.length === 1) return { status: 'resolved', target: sameDoc[0], ambiguous: false };
    if (sameDoc.length > 1) {
      return { status: 'resolved', target: [...sameDoc].sort((a, b) => a.segmentId.localeCompare(b.segmentId))[0], ambiguous: true };
    }
  }
  const sorted = [...candidates].sort((a, b) => a.segmentId.localeCompare(b.segmentId));
  return { status: 'resolved', target: sorted[0], ambiguous: sorted.length > 1 };
}
