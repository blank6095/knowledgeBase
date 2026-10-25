import { describe, expect, it } from 'vitest';
import { contextOf, locate, MIN_QUOTE_LEN } from '../annotations';

const text = '前言语料。第一段提到记忆曲线，第二段再次提到记忆曲线，最后复述记忆曲线。';

describe('locate 三级重定位', () => {
  it('精确：按 occurrence 命中对应出现位置', () => {
    const r = locate({ quote: '记忆曲线', occurrence: 2 }, text);
    expect(r).not.toBeNull();
    expect(r!.fuzzy).toBe(false);
    const first = text.indexOf('记忆曲线');
    expect(r!.start).toBe(text.indexOf('记忆曲线', first + 4));
    expect(text.slice(r!.start, r!.end)).toBe('记忆曲线');
  });

  it('唯一引文：occurrence 漂移仍可定位（模糊）', () => {
    const r = locate({ quote: '前言语料', occurrence: 3 }, text);
    expect(r).not.toBeNull();
    expect(r!.fuzzy).toBe(true);
    expect(r!.start).toBe(0);
  });

  it('上下文吻合：多处出现用 prefix/suffix 挑选（模糊）', () => {
    const full = '甲乙记忆曲线丙。中间记忆曲线丁。结尾记忆曲线戊。';
    const third = full.lastIndexOf('记忆曲线');
    const anchor = {
      quote: '记忆曲线',
      occurrence: 3,
      prefix: full.slice(third - 4, third),
      suffix: full.slice(third + 4, third + 8),
    };
    // 内容编辑删掉了第二处，只剩两处 → 精确失败、非唯一 → 上下文挑选
    const edited = full.replace('中间记忆曲线丁。', '中间丁。');
    const r = locate(anchor, edited);
    expect(r).not.toBeNull();
    expect(r!.fuzzy).toBe(true);
    expect(edited.slice(r!.start - 2, r!.start)).toContain('结尾');
  });

  it('失效：引文被删返回 null', () => {
    expect(locate({ quote: '不存在的引文内容', occurrence: 1 }, text)).toBeNull();
  });

  it('过短引文拒绝定位', () => {
    expect(locate({ quote: '记', occurrence: 1 }, text)).toBeNull();
    expect(MIN_QUOTE_LEN).toBeGreaterThanOrEqual(2);
  });

  it('contextOf 截取前后快照', () => {
    const c = contextOf('abcdef', 2, 4);
    expect(c.prefix).toBe('ab');
    expect(c.suffix).toBe('ef');
  });
});
