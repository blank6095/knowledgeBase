import { describe, expect, it } from 'vitest';
import { splitMarkdown } from '../splitter';

const doc = (s: string) => s.trim().replace(/\n{8}/g, '\n\n\n\n\n\n\n');
const norm = (s: string) => s.replace(/\s+/g, '');
/** 生成指定长度的单句段落（句号收尾，无句中边界） */
const para = (n: number) => '内容句'.repeat(Math.ceil(n / 3)).slice(0, n - 1) + '。';

describe('splitMarkdown 基本结构', () => {
  it('按二级标题切分知识点', () => {
    const md = doc(`
# React 学习笔记

## Hooks 简介

React Hooks 让函数组件拥有状态能力。

## useState

useState 返回状态与更新函数。
`);
    const { segments } = splitMarkdown(md);
    expect(segments.map((s) => s.title)).toEqual(['Hooks 简介', 'useState']);
  });

  it('frontmatter 标题作为导语段标题，标签被提取', () => {
    const md = `---
title: 数据库索引
tags: [数据库, 性能]
---

索引是加速查询的数据结构。
`;
    const { fmTitle, fmTags, segments } = splitMarkdown(md);
    expect(fmTitle).toBe('数据库索引');
    expect(fmTags).toEqual(['数据库', '性能']);
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe('数据库索引');
  });

  it('超长章节按段落组块并标注（续）', () => {
    const para = '这是一段很长的内容。'.repeat(60); // ~600 字符
    const md = `## 长章节\n\n${para}\n\n${para}\n\n${para}`;
    const { segments } = splitMarkdown(md, { maxChars: 800, minChars: 50 });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].title).toBe('长章节');
    expect(segments[1].title).toContain('续');
    segments.forEach((s) => expect(s.content.length).toBeLessThanOrEqual(900));
  });

  it('## 章节保持独立（即使内容很短），不被跨节合并', () => {
    const md = doc(`
## 正常章节

这段内容长度适中，可以独立成为一个知识点。

## 太短

一句话。
`);
    const { segments } = splitMarkdown(md, { maxChars: 1200, minChars: 80 });
    expect(segments).toHaveLength(2);
    expect(segments[1].title).toBe('太短');
    expect(segments[1].content).toBe('一句话。');
  });

  it('过短的文档导语并入第一个章节', () => {
    const md = doc(`
先说两句背景。

## 主题

这里是主题内容，长度足够成为独立的知识点。
`);
    const { segments } = splitMarkdown(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe('主题');
    expect(segments[0].content.startsWith('先说两句背景。')).toBe(true);
  });

  it('无标题的短文档整体作为一个知识点', () => {
    const { segments } = splitMarkdown('只有一个段落的零散想法，没有结构。'.repeat(5));
    expect(segments).toHaveLength(1);
  });

  it('headingPath 记录到节级；折叠的子标题保留在内容中', () => {
    const md = doc(`
## 基础篇

### 索引原理

B+ 树是数据库索引的常见结构。
`);
    const { segments } = splitMarkdown(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].headingPath).toBe('基础篇');
    expect(segments[0].content).toContain('### 索引原理');
    expect(segments[0].content).toContain('B+ 树');
  });
});

describe('粒度调粗：### / #### 折入父节', () => {
  it('含多个 ### 的 ## 章节默认产出 1 个知识点，内容含子标题文本', () => {
    const md = doc(`
## 传输层

### TCP

面向连接。

### UDP

无连接。

#### QUIC

基于 UDP 的可靠传输。
`);
    const { segments } = splitMarkdown(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe('传输层');
    expect(segments[0].headingPath).toBe('传输层');
    expect(segments[0].content).toContain('### TCP');
    expect(segments[0].content).toContain('面向连接。');
    expect(segments[0].content).toContain('### UDP');
    expect(segments[0].content).toContain('#### QUIC');
    expect(segments[0].content).toContain('基于 UDP 的可靠传输。');
  });

  it('章节超 maxChars 时在 ### 边界二次拆分：标题与 headingPath 落到拆分段', () => {
    const md = [
      '## 传输层',
      '',
      para(400),
      '',
      '### TCP',
      '',
      para(400),
      '',
      '### UDP',
      '',
      para(150), // 短小节
      '',
      '### QUIC',
      '',
      para(400),
    ].join('\n');
    const { segments } = splitMarkdown(md, { maxChars: 600 });
    expect(segments.map((s) => s.title)).toEqual(['传输层', 'TCP', 'QUIC']);
    expect(segments[1].headingPath).toBe('传输层 > TCP');
    expect(segments[2].headingPath).toBe('传输层 > QUIC');
    // 拆分边界在子标题处：段内容以 ### 标题行开头
    expect(segments[1].content.startsWith('### TCP')).toBe(true);
    expect(segments[2].content.startsWith('### QUIC')).toBe(true);
    // 短小节 UDP（<300）并入前一拆分段，不独立成段
    expect(segments[1].content).toContain('### UDP');
    expect(segments.filter((s) => s.title === 'UDP')).toHaveLength(0);
  });

  it('二次拆分后内容不丢失（含折叠的子标题行）', () => {
    const a = para(400);
    const b = para(400);
    const c = para(150);
    const d = para(400);
    const md = ['## 传输层', '', a, '', '### TCP', '', b, '', '### UDP', '', c, '', '### QUIC', '', d].join('\n');
    const { segments } = splitMarkdown(md, { maxChars: 600 });
    const original = norm([a, '### TCP', b, '### UDP', c, '### QUIC', d].join(''));
    expect(norm(segments.map((s) => s.content).join(''))).toBe(original);
  });

  it('折叠单段情形下内容不丢失（导语、子标题、深层标题均在）', () => {
    const md = doc(`
## 传输层

引言一段。

### TCP

面向连接。

#### QUIC

基于 UDP。
`);
    const { segments } = splitMarkdown(md);
    const original = norm(['引言一段。', '### TCP', '面向连接。', '#### QUIC', '基于 UDP。'].join(''));
    expect(norm(segments.map((s) => s.content).join(''))).toBe(original);
  });
});

describe('结构化拆解', () => {
  it('2000+ 字无标题单段按句子边界拆分，无句中截断', () => {
    const sentence = (i: number) => `这是第${i}句用来检验句子边界拆分行为的内容，长度适中。`;
    const text = Array.from({ length: 100 }, (_, i) => sentence(i + 1)).join('');
    expect(text.length).toBeGreaterThan(2000);
    const { segments } = splitMarkdown(text, { maxChars: 300, minChars: 40 });
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      // 无句中截断：每段以句末标点收尾
      expect(s.content.endsWith('。')).toBe(true);
    }
    // 软上限：均不超过 上限 + 防碎片合并容差（minChars + 单句长度）
    expect(segments.every((s) => s.content.length <= 300 + 40 + 30)).toBe(true);
    // 内容不丢失且不重复：归一化拼接与原文一致，每句恰好出现在一个知识点中
    expect(segments.map((s) => s.content).join('').replace(/\s+/g, '')).toBe(text);
    for (let i = 1; i <= 100; i++) {
      expect(segments.filter((s) => s.content.includes(`第${i}句`))).toHaveLength(1);
    }
  });

  it('单句超上限时整体保留（上限是软约束，绝不句中截断）', () => {
    const giant = '无'.repeat(500);
    const { segments } = splitMarkdown(giant, { maxChars: 200 });
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toHaveLength(500);
  });

  it('含空行的代码块完整落在单个知识点', () => {
    const md = doc(`
## 示例代码

\`\`\`js
const a = 1;

const b = 2;
\`\`\`

后续说明。
`);
    const { segments } = splitMarkdown(md, { maxChars: 25, minChars: 80 });
    const codeSeg = segments.find((s) => s.content.includes('const a = 1'));
    expect(codeSeg).toBeDefined();
    expect(codeSeg!.content).toContain('const b = 2');
    expect(codeSeg!.content).toContain('```');
  });

  it('全片段拼接内容不丢失（段落/代码/表格/列表混合）', () => {
    const parts = [
      '甲段内容第一句。甲段内容第二句！',
      '```py\nx = 1\n\ny = 2\n```',
      '| 列 | 值 |\n| --- | --- |\n| a | 1 |',
      '- 条目甲：说明一\n- 条目乙：说明二',
    ];
    const md = `## A\n\n${parts[0]}\n\n## B\n\n${parts[1]}\n\n${parts[2]}\n\n${parts[3]}`;
    const { segments } = splitMarkdown(md, { maxChars: 120 });
    expect(norm(segments.map((s) => s.content).join(''))).toBe(norm(parts.join('')));
  });
});
