import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SegmentEditCard from '@/components/SegmentEditCard';

const noop = async () => undefined;

describe('SegmentEditCard 阅读路径上的单段编辑卡', () => {
  const html = renderToStaticMarkup(
    <SegmentEditCard
      segment={{ id: 'seg-1', title: '标题甲', content: '正文内容', tags: ['标签一', '标签二'] }}
      onSaved={noop}
      onDeleted={noop}
      onCancel={() => undefined}
    />,
  );

  it('渲染可编辑的标题与正文', () => {
    expect(html).toContain('标题甲');
    expect(html).toContain('正文内容');
    expect(html).toContain('知识点标题');
    expect(html).toContain('知识点内容');
  });

  it('标签按逗号回填并保留记忆数据提示', () => {
    expect(html).toContain('标签一, 标签二');
    expect(html).toContain('记忆数据保留');
  });

  it('提供保存、取消、删除与预览切换入口', () => {
    for (const label of ['保存', '取消', '✕ 删除', '预览']) {
      expect(html).toContain(label);
    }
  });
});
