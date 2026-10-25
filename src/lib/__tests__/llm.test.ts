import { describe, expect, it } from 'vitest';
import { extractJson, isRetryableError, pickModel, type LlmConfig } from '../llm';

const cfg: LlmConfig = { apiKey: 'sk-test', model: 'main-model', fastModel: 'fast-model' };

describe('pickModel 模型分档', () => {
  it('default 档用主模型，fast 档用 fastModel', () => {
    expect(pickModel(cfg, 'default')).toBe('main-model');
    expect(pickModel(cfg, 'fast')).toBe('fast-model');
  });

  it('未配置 fastModel 时 fast 档回退主模型', () => {
    expect(pickModel({ ...cfg, fastModel: '' }, 'fast')).toBe('main-model');
  });

  it('缺省 tier 视为 default', () => {
    expect(pickModel(cfg)).toBe('main-model');
  });
});

describe('isRetryableError 重试判定', () => {
  const withStatus = (status: number) => {
    const e = new Error(`HTTP ${status}`);
    (e as { status?: number }).status = status;
    return e;
  };

  it('网络错误/超时/空返回（无 status）可重试', () => {
    expect(isRetryableError(new Error('大模型请求失败：网络错误：fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('大模型返回为空'))).toBe(true);
  });

  it('429 与 5xx 可重试', () => {
    expect(isRetryableError(withStatus(429))).toBe(true);
    expect(isRetryableError(withStatus(500))).toBe(true);
    expect(isRetryableError(withStatus(503))).toBe(true);
  });

  it('其余 4xx 不重试（密钥/参数错误重试无意义）', () => {
    expect(isRetryableError(withStatus(400))).toBe(false);
    expect(isRetryableError(withStatus(401))).toBe(false);
    expect(isRetryableError(withStatus(404))).toBe(false);
  });
});

describe('extractJson（LLM 输出 → JSON）', () => {
  it('最小合法用例：对象与数组', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('[{"title":"x"}]')).toEqual([{ title: 'x' }]);
  });

  it('剥离 ``` 围栏（含 json 语言标注）', () => {
    const out = '```json\n[{"title":"A","content":"B"}]\n```';
    expect(extractJson(out)).toEqual([{ title: 'A', content: 'B' }]);
    const bare = '```\n{"ok":true}\n```';
    expect(extractJson(bare)).toEqual({ ok: true });
  });

  it('容忍前后废话文本', () => {
    const out = '好的，以下是拆解结果：\n```json\n[{"title":"T"}]\n```\n希望对你有帮助！';
    expect(extractJson(out)).toEqual([{ title: 'T' }]);
    const plain = '结果如下 [1, 2, 3] 以上。';
    expect(extractJson(plain)).toEqual([1, 2, 3]);
  });

  it('字符串字面量内的括号不参与配对', () => {
    const out = '{"s": "a]b}c[", "n": 2}';
    expect(extractJson(out)).toEqual({ s: 'a]b}c[', n: 2 });
  });

  it('非法 JSON 抛可读错误', () => {
    expect(() => extractJson('[{title: 没有引号}]')).toThrow(/JSON 无法解析/);
    expect(() => extractJson('完全不是 JSON 的文本')).toThrow(/没有找到 JSON/);
    expect(() => extractJson('{"a": 1')).toThrow(/括号未配对/);
    expect(() => extractJson('```json\n[{"a":1}\n```')).toThrow(/括号未配对/);
  });
});
