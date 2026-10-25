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

/** 阅读优先的默认粒度：## 开段、###/#### 并入父节，超长才二次拆分 */
const DEFAULTS = { maxChars: 1800, minChars: 300 };

type BlockType = 'paragraph' | 'code' | 'table' | 'list';
/** 块级单元：code 与 table 为原子块，任何情况不在内部切分 */
interface Block {
  type: BlockType;
  text: string;
}

/** ## 节内折叠的子标题组：###（或无 ### 时的 ####）为边界，更深层级并入其行 */
interface SubSection {
  title: string;
  level: number;
  /** 原始标题行（如 "### TCP"），折入内容时保留 */
  headingLine: string;
  lines: string[];
}

interface Section {
  title: string;
  path: string;
  /** 节标题与首个子标题之间的行 */
  lines: string[];
  subs: SubSection[];
  blocks: Block[];
  subBlocks: Block[][];
}

/**
 * 把 Markdown 文档结构化拆解为阅读单元：
 * 1. 仅 ## 开启新知识点；###/#### 连同标题行并入父节（内容不丢失），headingPath 保留到节级；
 * 2. 父节内容超 maxChars 时才在子标题边界二次拆分（拆出的小节标题入 title/headingPath）；
 * 3. 二次拆分时 <minChars 的短小节并入前一组（软上限，保证不产生孤悬碎片）；
 * 4. 超长段落按句子边界、超长列表按条目降级；代码围栏与表格为原子块，绝不内部切分；
 * 5. 单句/单条目超上限时整体保留，绝不在句中截断。
 */
export function splitMarkdown(
  md: string,
  opts: SplitOptions = {},
): { fmTitle?: string; fmTags: string[]; segments: RawSegment[] } {
  const { maxChars, minChars } = { ...DEFAULTS, ...opts };
  const { fm, body } = parseFrontmatter(md);
  const { prefaceLines, sections } = toSections(body.split(/\r?\n/));

  const sectionSegments: RawSegment[] = [];
  for (const sec of sections) sectionSegments.push(...sectionToSegments(sec, maxChars, minChars));

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

/** 行流 → 节：仅 ## 开新节；###/#### 折入当前节（记录子标题边界）；首个标题前为导语 */
function toSections(lines: string[]): { prefaceLines: string[]; sections: Section[] } {
  const prefaceLines: string[] = [];
  const sections: Section[] = [];
  let cur: Section | null = null;
  let curSub: SubSection | null = null;

  for (const line of lines) {
    const h = line.match(/^(#{2,4})\s+(.*)/);
    if (h && h[1].length === 2) {
      cur = { title: h[2].trim(), path: h[2].trim(), lines: [], subs: [], blocks: [], subBlocks: [] };
      sections.push(cur);
      curSub = null;
    } else if (h && cur) {
      const level = h[1].length;
      if (!curSub || level <= curSub.level) {
        curSub = { title: h[2].trim(), level, headingLine: line.trim(), lines: [] };
        cur.subs.push(curSub);
      } else {
        // 更深层级（如 ### 下的 ####）：作为内容并入当前小节，标题行保留
        curSub.lines.push(line);
      }
    } else if (cur) {
      if (curSub) curSub.lines.push(line);
      else cur.lines.push(line);
    } else {
      prefaceLines.push(line);
    }
  }
  for (const sec of sections) {
    sec.blocks = toBlocks(sec.lines);
    sec.subBlocks = sec.subs.map((sub) => toBlocks(sub.lines));
  }
  return { prefaceLines, sections };
}

/** 子标题块的伪块：折入内容时保留原始标题行，使内容与原文一致 */
const headingBlock = (line: string): Block => ({ type: 'paragraph', text: line });

/** 单节 → 知识点段：未超限折叠为一段；超限才在子标题边界二次拆分 */
function sectionToSegments(sec: Section, maxChars: number, minChars: number): RawSegment[] {
  if (sec.subs.length === 0) {
    return piecesToSegments([{ title: sec.title, path: sec.path, blocks: sec.blocks }], maxChars, minChars);
  }

  const totalLen =
    blocksLen(sec.blocks) +
    sec.subs.reduce((sum, sub, i) => sum + sub.headingLine.length + 2 + blocksLen(sec.subBlocks[i]), 0);

  if (totalLen <= maxChars) {
    const blocks = [...sec.blocks];
    sec.subs.forEach((sub, i) => {
      blocks.push(headingBlock(sub.headingLine));
      blocks.push(...sec.subBlocks[i]);
    });
    return piecesToSegments([{ title: sec.title, path: sec.path, blocks }], maxChars, minChars);
  }

  // 二次拆分：intro 与各子标题各成 piece，贪心打包（短小节并入前组，避免孤悬碎片）
  const pieces: { title: string; path: string; blocks: Block[] }[] = [
    { title: sec.title, path: sec.path, blocks: sec.blocks },
  ];
  sec.subs.forEach((sub, i) =>
    pieces.push({
      title: sub.title,
      path: `${sec.path} > ${sub.title}`,
      blocks: [headingBlock(sub.headingLine), ...sec.subBlocks[i]],
    }),
  );

  const groups: (typeof pieces)[] = [];
  let cur: typeof pieces = [];
  let curLen = 0;
  for (const p of pieces) {
    const pLen = blocksLen(p.blocks);
    if (cur.length === 0) {
      cur = [p];
      curLen = pLen;
    } else if (curLen + pLen <= maxChars || (curLen < minChars && pLen <= maxChars)) {
      cur.push(p);
      curLen += pLen;
    } else {
      groups.push(cur);
      cur = [p];
      curLen = pLen;
    }
  }
  if (cur.length) groups.push(cur);

  return groups.flatMap((g) => piecesToSegments(g, maxChars, minChars));
}

function blocksLen(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.text.length + 2, 0);
}

/** 一组 pieces → 知识点段：组内仍超限时按块结构降级并标（续） */
function piecesToSegments(
  pieces: { title: string; path: string; blocks: Block[] }[],
  maxChars: number,
  minChars: number,
): RawSegment[] {
  const head = pieces.find((p) => p.blocks.length > 0) ?? pieces[0];
  const frags = splitBlocks(pieces.flatMap((p) => p.blocks), maxChars, minChars);
  return frags.map((text, i) => ({
    title: i === 0 ? head.title : `${head.title}（续 ${i + 1}）`,
    content: text,
    headingPath: head.path,
  }));
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
