import { parseFrontmatter } from './markdown';

export interface RawSegment {
  title: string;
  content: string;
  headingPath: string;
}

export interface SplitOptions {
  /** 单个知识点建议的最大字符数，超出则继续向下分割 */
  maxChars?: number;
  /** 小于该长度的片段并入前一个知识点，避免碎片 */
  minChars?: number;
}

const DEFAULTS = { maxChars: 1200, minChars: 80 };

/**
 * 把 Markdown 文档理性分割为可复习的知识点：
 * 1. 剥离 frontmatter，按 ## 二级标题切分为章节；
 * 2. 章节过长时按段落贪心组块，标注（续 N）；
 * 3. 带标题的章节是作者划分的语义单元，无论长短都保留为独立知识点；
 *    只有开头过短的导语并入第一节，避免碎片。
 */
export function splitMarkdown(md: string, opts: SplitOptions = {}): { fmTitle?: string; fmTags: string[]; segments: RawSegment[] } {
  const { maxChars, minChars } = { ...DEFAULTS, ...opts };
  const { fm, body } = parseFrontmatter(md);
  const lines = body.split(/\r?\n/);

  // 按标题层级收集块：h2 章节，h3 小节
  type Block = { h2: string; h3: string | null; lines: string[] };
  const blocks: Block[] = [];
  const preface: string[] = [];
  let cur: Block | null = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    if (h2) {
      cur = { h2: h2[1].trim(), h3: null, lines: [] };
      blocks.push(cur);
    } else if (h3 && cur) {
      cur.h3 = h3[1].trim();
      cur.lines.push(line);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preface.push(line);
    }
  }

  const segments: RawSegment[] = [];
  const push = (title: string, headingPath: string, text: string) => {
    const content = text.trim();
    if (content) segments.push({ title, content, headingPath });
  };

  const prefaceText = preface.join('\n').trim();
  if (prefaceText.length >= minChars) {
    const t = fm.title ?? '概述';
    push(t, t, prefaceText);
  }

  for (const block of blocks) {
    const path = block.h3 ? `${block.h2} > ${block.h3}` : block.h2;
    const title = block.h3 ?? block.h2;
    const text = block.lines.join('\n').trim();
    if (text.length <= maxChars) {
      push(title, path, text);
      continue;
    }
    // 过长：按段落贪心组块
    chunkParagraphs(title, path, text, maxChars).forEach((c) => segments.push(c));
  }

  // 过短导语并入第一个章节（而不是丢弃，内容不丢失）
  if (prefaceText && prefaceText.length < minChars) {
    if (segments.length > 0) {
      segments[0].content = `${prefaceText}\n\n${segments[0].content}`;
    } else {
      const t = fm.title ?? '未命名笔记';
      push(t, t, prefaceText);
    }
  }

  return { fmTitle: fm.title, fmTags: fm.tags, segments };
}

function chunkParagraphs(title: string, path: string, text: string, maxChars: number): RawSegment[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: RawSegment[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length) {
      chunks.push({
        title: chunks.length === 0 ? title : `${title}（续 ${chunks.length + 1}）`,
        content: buf.join('\n\n'),
        headingPath: path,
      });
      buf = [];
      bufLen = 0;
    }
  };

  for (const p of paragraphs) {
    // 单段超长：硬切
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars) {
        chunks.push({
          title: `${title}（续 ${chunks.length + 1}）`,
          content: p.slice(i, i + maxChars),
          headingPath: path,
        });
      }
      continue;
    }
    if (bufLen + p.length + 2 > maxChars) flush();
    buf.push(p);
    bufLen += p.length + 2;
  }
  flush();
  return chunks;
}
