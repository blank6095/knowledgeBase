'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/client';
import AiOverlay from '@/components/AiOverlay';

interface SplitChild {
  title: string;
  content: string;
}

/**
 * 编辑模式下的段编辑卡：标题 / 内容（mono textarea + 预览切换）/ 标签，
 * 以及段结构操作（选中·上移·下移·在其后插入·AI 拆解·删除）。
 * 保存走 PATCH /api/segments/[id]，记忆字段由服务端保留。
 * AI 拆解：preview（/api/ai/split-preview）→ 浮层确认 → apply（/api/ai/split-apply）。
 */
export default function SectionEditor({
  index,
  segment,
  selected,
  onToggleSelect,
  llmReady,
  onStructureChanged,
  onSaved,
  onInsertAfter,
}: {
  index: number;
  segment: { id: string; title: string; content: string; tags: string[] };
  selected: boolean;
  onToggleSelect: () => void;
  llmReady: boolean;
  onStructureChanged: () => Promise<unknown>;
  onSaved: () => Promise<unknown>;
  onInsertAfter: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(segment.title);
  const [content, setContent] = useState(segment.content);
  const [tagsInput, setTagsInput] = useState(segment.tags.join(', '));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // AI 拆解
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitMsg, setSplitMsg] = useState('');
  const [splitPreview, setSplitPreview] = useState<SplitChild[] | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!title.trim()) {
        setMsg('标题不能为空');
        return;
      }
      await api(`/api/segments/${segment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          content,
          tags: tagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        }),
      });
      await onSaved();
    });

  const move = (direction: 'up' | 'down') =>
    run(async () => {
      await api(`/api/segments/${segment.id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
      await onStructureChanged();
    });

  const insertAfter = () =>
    run(async () => {
      await onInsertAfter();
    });

  const remove = () => {
    if (!window.confirm(`删除「${segment.title}」？其划线与笔记将一并删除，阅读历史不再保留。`)) return;
    run(async () => {
      await api(`/api/segments/${segment.id}`, { method: 'DELETE' });
      await onStructureChanged();
    });
  };

  const splitPreviewCall = async () => {
    setSplitBusy(true);
    setSplitMsg('');
    try {
      const d = await api<{ children: SplitChild[] }>('/api/ai/split-preview', {
        method: 'POST',
        body: JSON.stringify({ segmentId: segment.id }),
      });
      setSplitPreview(d.children);
    } catch (e) {
      setSplitMsg(e instanceof Error ? e.message : '拆解失败');
    } finally {
      setSplitBusy(false);
    }
  };

  const splitApply = async () => {
    if (!splitPreview) return;
    setSplitBusy(true);
    setSplitMsg('');
    try {
      await api('/api/ai/split-apply', {
        method: 'POST',
        body: JSON.stringify({ segmentId: segment.id, children: splitPreview }),
      });
      setSplitPreview(null);
      await onStructureChanged();
    } catch (e) {
      setSplitMsg(e instanceof Error ? e.message : '应用拆解失败');
    } finally {
      setSplitBusy(false);
    }
  };

  const splitDisabled = busy || splitBusy || !llmReady;

  return (
    <section className="card fade-up space-y-3 px-4 py-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`选中「${segment.title}」以聚合`}
          title="选中以聚合"
          className="accent-accent"
        />
        <span className="w-5 shrink-0 text-right font-mono text-tag tabular-nums text-faint">{index + 1}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 font-display text-body text-primary outline-none transition-colors focus:border-accent"
          placeholder="段落标题"
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setPreview((p) => !p)}
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
          >
            {preview ? '编辑' : '预览'}
          </button>
          <button
            onClick={() => move('up')}
            disabled={busy}
            title="上移"
            aria-label="上移"
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            ↑
          </button>
          <button
            onClick={() => move('down')}
            disabled={busy}
            title="下移"
            aria-label="下移"
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            ↓
          </button>
          <button
            onClick={insertAfter}
            disabled={busy}
            title="在其后插入一段"
            aria-label="在其后插入一段"
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            ＋
          </button>
          <button
            onClick={splitPreviewCall}
            disabled={splitDisabled}
            title={llmReady ? 'AI 语义拆解（预览后应用）' : '未配置大模型：到侧边栏「设置」页填写 DeepSeek API Key，保存后立即可用'}
            aria-label="AI 语义拆解"
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted"
          >
            {splitBusy ? '…' : '✨'}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            title="删除"
            aria-label="删除段落"
            className="rounded-md border border-line px-2 py-1 text-tag text-muted transition-colors duration-150 hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      </div>

      {preview ? (
        <div className="md-body min-h-16 rounded-lg border border-line bg-app/50 px-3 py-2">
          <Markdown remarkPlugins={[remarkGfm]}>{content || '（空）'}</Markdown>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={Math.min(18, Math.max(4, content.split('\n').length + 1))}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-line bg-app px-3 py-2 font-mono text-minor leading-relaxed text-primary outline-none transition-colors focus:border-accent"
          placeholder="段落内容（Markdown）"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
          placeholder="标签，逗号分隔"
        />
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <span className="text-tag text-faint">记忆数据保留</span>
        {msg && <span className="text-tag text-danger">{msg}</span>}
        {splitMsg && <span className="text-tag text-danger">{splitMsg}</span>}
      </div>

      {/* AI 拆解预览浮层：只读子段列表 → 确认应用 */}
      {splitPreview && (
        <AiOverlay
          title="AI 拆解预览"
          subtitle={`拆为 ${splitPreview.length} 个子段：母段更新为第一子段，其余按序插入；划线与笔记将按内容迁移`}
          onClose={() => setSplitPreview(null)}
          footer={
            <>
              <button
                onClick={() => setSplitPreview(null)}
                className="rounded-lg border border-line px-4 py-1.5 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
              >
                取消
              </button>
              <button
                onClick={splitApply}
                disabled={splitBusy}
                className="rounded-lg bg-accent px-4 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                {splitBusy ? '应用中…' : '应用拆解'}
              </button>
            </>
          }
        >
          <ol className="space-y-3">
            {splitPreview.map((c, i) => (
              <li key={i} className="rounded-lg border border-line bg-app/50 px-3 py-2.5">
                <p className="font-display text-minor font-semibold text-primary">
                  <span className="mr-1.5 font-mono text-tag tabular-nums text-faint">{i + 1}</span>
                  {c.title}
                </p>
                <div className="md-body mt-1 text-minor">
                  <Markdown remarkPlugins={[remarkGfm]}>{c.content}</Markdown>
                </div>
              </li>
            ))}
          </ol>
        </AiOverlay>
      )}
    </section>
  );
}
