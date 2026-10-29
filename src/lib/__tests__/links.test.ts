import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  db: { execute: (query: unknown) => ({ query }) },
}));

const { rebuildDocQueries, rebuildLinksQueries } = await import('../links');

const ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

describe('关系边事务查询', () => {
  it('空段列表不产生无效查询', () => {
    expect(rebuildLinksQueries([])).toEqual([]);
  });

  it('段边由删除、wiki、tag 三条查询组成', () => {
    const queries = rebuildLinksQueries([ID]);
    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query).toHaveProperty('query');
  });

  it('文档边由清理、重连、段数回写三条查询组成', () => {
    const queries = rebuildDocQueries(DOC_ID);
    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query).toHaveProperty('query');
  });
});
