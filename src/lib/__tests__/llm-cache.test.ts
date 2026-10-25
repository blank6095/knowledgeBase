import { describe, expect, it } from 'vitest';
import { cacheKey } from '../llm-cache';

describe('cacheKey（LLM preview 输出缓存）', () => {
  it('同内容同模型同 kind → 同 key', () => {
    const a = cacheKey('split', 'deepseek-chat', '标题|内容');
    const b = cacheKey('split', 'deepseek-chat', '标题|内容');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('内容变 → key 变', () => {
    expect(cacheKey('split', 'm', 'a')).not.toBe(cacheKey('split', 'm', 'a2'));
  });

  it('模型变 → key 变', () => {
    expect(cacheKey('split', 'deepseek-chat', 'fp')).not.toBe(cacheKey('split', 'deepseek-reasoner', 'fp'));
  });

  it('kind 变 → key 变（split 与 aggregate 互不命中）', () => {
    expect(cacheKey('split', 'm', 'fp')).not.toBe(cacheKey('aggregate', 'm', 'fp'));
  });

  it('指纹含分隔符：段拼接边界不同即不同 key', () => {
    // 「a|b」+「c」 与 「a」+「b|c」 的拼接分别为 "a|b\nc\..." 结构不同
    const x = cacheKey('aggregate', 'm', 'a|b\nc');
    const y = cacheKey('aggregate', 'm', 'a\nb|c');
    expect(x).not.toBe(y);
  });
});
