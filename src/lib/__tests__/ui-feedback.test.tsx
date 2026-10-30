import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InlineFeedback from '@/components/InlineFeedback';
import ErrorState from '@/components/ErrorState';

describe('InlineFeedback 统一反馈语义', () => {
  it('错误用 role="alert"，可被辅助技术立即播报', () => {
    const html = renderToStaticMarkup(<InlineFeedback tone="danger">保存失败</InlineFeedback>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('保存失败');
    expect(html).toContain('text-danger');
  });

  it('非错误使用 aria-live="polite"，不打断当前朗读', () => {
    const html = renderToStaticMarkup(<InlineFeedback tone="success">已保存</InlineFeedback>);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="alert"');
  });

  it('默认 tone 为 info（中性提示）', () => {
    const html = renderToStaticMarkup(<InlineFeedback>提示</InlineFeedback>);
    expect(html).toContain('text-muted');
  });
});

describe('ErrorState 页面级错误态', () => {
  it('展示原因与安全去向', () => {
    const html = renderToStaticMarkup(<ErrorState message="数据库连接失败" />);
    expect(html).toContain('数据库连接失败');
    expect(html).toContain('回到知识库');
    expect(html).toContain('role="alert"');
  });

  it('提供重试回调时渲染重试按钮', () => {
    const html = renderToStaticMarkup(<ErrorState message="加载失败" onRetry={() => undefined} />);
    expect(html).toContain('重试');
  });

  it('可自定义去向', () => {
    const html = renderToStaticMarkup(<ErrorState message="失败" action={{ href: '/graph', label: '去看图谱' }} />);
    expect(html).toContain('去看图谱');
    expect(html).toContain('href="/graph"');
  });
});
