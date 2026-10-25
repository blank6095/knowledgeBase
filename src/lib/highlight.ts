/**
 * 划线 DOM 注入（纯浏览器工具，不依赖 React）。
 *
 * 在容器的文本节点上把命中区间包裹为 <mark class="hl-mark">。
 * 每次先解包旧 mark 再注入，保证幂等；跨元素边界的引文会在各文本节点内
 * 分别成 mark（视觉连续）。区间偏移基于容器 textContent（与选区/locate 一致）。
 */

export interface MarkSpec {
  id: string;
  start: number;
  end: number;
  color: string;
  hasNote: boolean;
}

interface TextEntry {
  node: Text;
  start: number;
  end: number;
}

function collectTextNodes(container: HTMLElement): { entries: TextEntry[]; total: number } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const entries: TextEntry[] = [];
  let offset = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue?.length ?? 0;
    if (len > 0) {
      entries.push({ node: n as Text, start: offset, end: offset + len });
      offset += len;
    }
  }
  return { entries, total: offset };
}

/** 移除容器内全部已注入 mark（还原为纯文本节点） */
function unwrapAll(container: HTMLElement): void {
  const marks = Array.from(container.querySelectorAll('mark.hl-mark'));
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  }
  if (marks.length > 0) container.normalize();
}

/**
 * 注入划线；返回成功注入的 spec id（用于失效检测）。
 * 同一标注跨多个文本节点时产生多个 mark，均带 data-aid。
 */
export function injectMarks(container: HTMLElement, specs: MarkSpec[]): Set<string> {
  unwrapAll(container);
  const done = new Set<string>();
  if (specs.length === 0) return done;

  for (const spec of specs) {
    if (spec.end <= spec.start) continue;
    // 逐 spec 重算文本节点表：上一次拆分会改变节点结构
    const { entries } = collectTextNodes(container);
    for (const entry of entries) {
      if (entry.node.parentElement?.closest('mark.hl-mark')) continue;
      const s = Math.max(spec.start, entry.start);
      const e = Math.min(spec.end, entry.end);
      if (e <= s) continue;
      const node = entry.node;
      const mid = node.splitText(s - entry.start);
      if (e < entry.end) mid.splitText(e - s);
      const mark = document.createElement('mark');
      mark.className = `hl-mark${spec.hasNote ? ' hl-note' : ''}`;
      mark.dataset.aid = spec.id;
      mark.dataset.color = spec.color;
      mid.parentNode?.insertBefore(mark, mid);
      mark.appendChild(mid);
      done.add(spec.id);
    }
  }
  return done;
}
