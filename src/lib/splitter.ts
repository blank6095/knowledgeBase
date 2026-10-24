import { parseFrontmatter } from './markdown';

export interface RawSegment {
  title: string;
  content: string;
  headingPath: string;
}

export interface SplitOptions {
  /** 单个知识点的软上限：优先按标题层级拆解；超长段落按句子边界降级；单句超上限时整体保留 */
  maxChars?: number;
  /** 小于该长度的碎片并入同节前一片段，防止碎片化 */
  minChars?: number;
}

const DEFAULTS = { maxChars: 1200, minChars: 80 };

type BlockType = 'paragraph' | 'code' | 'table' | 'list';
/** 块级单元：code 与 table 为原子块，任何情况不在内部切分 */
interface Block {
  type: BlockType;
  text: string;
}

interface Section {
  title: string;
  path: string;
  lines: string[];
  blocks: Block[];
}

/**
 * 把 Markdown 文档结构化拆解为可复习单元：
 * 1. ##/###/#### 均开启新知识点，headingPath 逐级拼接（修复多 ### 被合并的缺陷）；
 * 2. 超长内容按结构降级：整块组块 → 段落按句子边界（。！？!?；;.）→ 列表按条目组；
 *    代码围栏与表格为原子块，绝不内部切分；
 * 3. 上限是软约束：单句/单条目超上限时整体保留，绝不在句中截断；
 * 4. minChars 防碎片（同节内折叠），内容不丢失。
 */
export function splitMarkdown(
  md: string,
  opts: SplitOptions = {},
): { fmTitle?: string; fmTags: string[]; segments: RawSegment[] } {
  const { maxChars, minChars } = { ...DEFAULTS, ...opts };
  const { fm, body } = parseFrontmatter(md);
  const { prefaceLines, sections } = toSections(body.split(/\r?\n/));

  const sectionSegments: RawSegment[] = [];
  for (const sec of sections) {
    const frags = splitBlocks(sec.blocks, maxChars, minChars);
    frags.forEach((text, i) =>
      sectionSegments.push({
        title: i === 0 ? sec.title : `${sec.title}（续 ${i + 1}）`,
        content: text,
        headingPath: sec.path,
      }),
    );
  }

  // 导语：够长则独立成段（同样按结构拆解）；过短并入第一节；全文无标题时兜底成段
  const segments: RawSegment[] = [];
  const prefaceBlocks = toBlocks(prefaceLines);
  const prefaceText = prefaceBlocks.map((b) => b.text).join('\n\n').trim();
  if (prefaceText) {
    if (prefaceText.length < minChars && sectionSegments.length > 0) {
      sectionSegments[0].content = `${prefaceText}\n\n${sectionSegments[0].content}`;
    } else {
      const title = fm.title ?? (sectionSegments.length > 0 ? '概述' : '未命名笔记');
      splitBlocks(prefaceBlocks, maxChars, minChars).forEach((text, i) =>
        segments.push({
          title: i === 0 ? title : `${title}（续 ${i + 1}）`,
          content: text,
          headingPath: title,
        }),
      );
    }
  }
  return { fmTitle: fm.title, fmTags: fm.tags, segments: [...segments, ...sectionSegments] };
}

/** 行流 → 节：##/###/#### 开新节，标题层级栈拼接 headingPath；首个标题前为导语 */
function toSections(lines: string[]): { prefaceLines: string[]; sections: Section[] } {
  const prefaceLines: string[] = [];
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let cur: Section | null = null;

  for (const line of lines) {
    const h = line.match(/^(#{2,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: h[2].trim() });
      cur = { title: h[2].trim(), path: stack.map((s) => s.text).join(' > '), lines: [], blocks: [] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      prefaceLines.push(line);
    }
  }
  for (const sec of sections) sec.blocks = toBlocks(sec.lines);
  return { prefaceLines, sections };
}

/** 行 → 原子块：代码围栏（含内部空行）、表格整块；列表连延续行；其余为段落 */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const isFence = (s: string) => /^\s*(```|~~~)/.test(s);
  const isTable = (s: string) => s.trim().startsWith('|');
  const isList = (s: string) => /^\s*([-*+]|\d+[.)])\s/.test(s);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      const marker = line.match(/^\s*(```|~~~)/)![1];
      const buf = [line];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) buf.push(lines[i++]);
      if (i < lines.length) buf.push(lines[i++]); // 收尾围栏
      blocks.push({ type: 'code', text: buf.join('\n') });
    } else if (isTable(line)) {
      const buf: string[] = [];
      while (i < lines.length && isTable(lines[i])) buf.push(lines[i++]);
      blocks.push({ type: 'table', text: buf.join('\n') });
    } else if (isList(line)) {
      const buf: string[] = [];
      while (i < lines.length && (isList(lines[i]) || (buf.length > 0 && /^\s+\S/.test(lines[i]) && lines[i].trim()))) {
        buf.push(lines[i++]);
      }
      blocks.push({ type: 'list', text: buf.join('\n') });
    } else if (!line.trim()) {
      i++;
    } else {
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isFence(lines[i]) &&
        !isTable(lines[i]) &&
        !isList(lines[i])
      ) {
        buf.push(lines[i++]);
      }
      blocks.push({ type: 'paragraph', text: buf.join('\n') });
    }
  }
  return blocks;
}

/** 节内降级拆分：整块贪心组块；超长段落按句子、超长列表按条目；code/table 原子保留 */
function splitBlocks(blocks: Block[], maxChars: number, minChars: number): string[] {
  const frags: string[] = [];
  let buf: string[] = [];
  let len = 0;
  const flush = () => {
    if (buf.length) {
      frags.push(buf.join('\n\n'));
      buf = [];
      len = 0;
    }
  };

  for (const b of blocks) {
    if (b.text.length > maxChars) {
      flush();
      if (b.type === 'paragraph') frags.push(...splitSentences(b.text, maxChars));
      else if (b.type === 'list') frags.push(...splitListItems(b.text, maxChars));
      else frags.push(b.text); // code / table 原子块
      continue;
    }
    if (buf.length && len + b.text.length + 2 > maxChars) flush();
    buf.push(b.text);
    len += b.text.length + 2;
    if (len >= maxChars) flush();
  }
  flush();

  // 同节内防碎片折叠：过短片段并入前一片段；首片过短并入后一片段
  const folded: string[] = [];
  for (const f of frags) {
    if (folded.length && f.length < minChars) folded[folded.length - 1] += `\n\n${f}`;
    else folded.push(f);
  }
  if (folded.length > 1 && folded[0].length < minChars) {
    folded[1] = `${folded[0]}\n\n${folded[1]}`;
    folded.shift();
  }
  return folded;
}

/** 句子边界（。！？!?；;.）贪心组句；单句超上限整体保留（软约束，绝不句中截断） */
function splitSentences(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^。！？!?；;]*[。！？!?；;]+|[^。！？!?；;]+/g) ?? [text];
  const frags: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + s.length > maxChars) {
      frags.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) frags.push(buf);
  return frags;
}

/** 列表按条目贪心分组；单条超上限整体保留 */
function splitListItems(text: string, maxChars: number): string[] {
  const frags: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of text.split('\n')) {
    if (buf.length && len + line.length + 1 > maxChars) {
      frags.push(buf.join('\n'));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += line.length + 1;
  }
  if (buf.length) frags.push(buf.join('\n'));
  return frags;
}
