import { describe, expect, it } from 'vitest';
import { splitMarkdown } from '../splitter';

const doc = (s: string) => s.trim().replace(/\n{8}/g, '\n\n\n\n\n\n\n');

describe('splitMarkdown', () => {
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

  it('超长章节按段落继续分割并标注（续）', () => {
    const para = '这是一段很长的内容。'.repeat(60); // ~660 字符
    const md = `## 长章节\n\n${para}\n\n${para}\n\n${para}`;
    const { segments } = splitMarkdown(md, { maxChars: 800, minChars: 50 });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].title).toBe('长章节');
    expect(segments[1].title).toContain('续');
    segments.forEach((s) => expect(s.content.length).toBeLessThanOrEqual(900));
  });

  it('短小的标题章节保留为独立知识点，不与其他章节合并', () => {
    const md = doc(`
## 正常章节

这段内容长度适中，可以独立成为一个知识点，用来复习正好。

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

这里是主题内容，长度足够成为独立的知识点，复习的时候刚刚好。
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

  it('headingPath 记录章节路径', () => {
    const md = doc(`
## 基础篇

### 索引原理

B+ 树是数据库索引的常见结构。
`);
    const { segments } = splitMarkdown(md);
    expect(segments[0].headingPath).toBe('基础篇 > 索引原理');
  });
});
