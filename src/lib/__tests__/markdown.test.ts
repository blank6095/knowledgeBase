import { describe, expect, it } from 'vitest';
import { extractInlineTags } from '../markdown';

describe('extractInlineTags', () => {
  it('提取正文中的行内标签', () => {
    expect(extractInlineTags('正文 #网络 #缓存\n下一行（#复习）')).toEqual(['网络', '缓存', '复习']);
  });

  it('忽略反引号与波浪线代码围栏内的伪标签', () => {
    const body = [
      '正文 #有效',
      '```ts',
      'const color = "#代码标签";',
      '```',
      '~~~',
      'shell #也不是标签',
      '~~~',
      '尾文 #仍有效',
    ].join('\n');
    expect(extractInlineTags(body)).toEqual(['有效', '仍有效']);
  });

  it('未闭合围栏后的内容不提取', () => {
    const body = '前缀 #正常\n```\n#代码\n后文 #也不提取';
    expect(extractInlineTags(body)).toEqual(['正常']);
  });
});
