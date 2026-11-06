'use client';

import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/client';

interface EditableSegment {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

/**
 * 知识点详情页的轻量编辑卡：只负责单段的标题/正文/标签与删除。
 * 结构操作（上移/下移/插入/AI 拆解）留在文档编辑模式，避免在阅读路径上重复入口。
 * 保存走 PATCH /api/segments/[id]，记忆字段与阅读历史由服务端保留。
 */
export default function SegmentEditCard({
  segment,
  onSaved,
  onDeleted,
  onCancel,
  onDirtyChange,
}: {
  segment: EditableSegment;
  onSaved: () => Promise<unknown>;
  onDeleted: () => Promise<unknown>;
  onCancel: () => void;
  /** 未保存改动变化时回调，供页面在「✓ 完成编辑」退出前确认 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(segment.title);
  const [content, setContent] = useState(segment.content);
  const [tagsInput, setTagsInput] = useState(segment.tags.join(', '));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // 草稿脏状态：与已保存值比较。ref 记录上次上报值，父组件回调身份变化时不重复通知；
  // 首屏本地 state 与 props 相同（dirty=false），不会误报。
  const tagsText = segment.tags.join(', ');
  const dirty = title !== segment.title || content !== segment.content || tagsInput !== tagsText;
  const lastDirtyRef = useRef(false);
  useEffect(() => {
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!title.trim()) {
        setMsg('标题不能为空');
        setBusy(false);
        return;
      }
      await api(`/api/segments/${segment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          content,
          tags: tagsInput
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      await onSaved();
    });

  const remove = () => {
    if (!window.confirm(`删除「${segment.title}」？其划线与笔记将一并删除，阅读历史不再保留。`)) return;
    void run(async () => {
      await api(`/api/segments/${segment.id}`, { method: 'DELETE' });
      await onDeleted();
    });
  };

  // 有未保存改动时先确认，避免一键丢弃草稿（无改动直接退出）。
  const cancel = () => {
    if (busy) return;
    if (dirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
    onCancel();
  };

  return (
    <section className="card fade-up mt-4 space-y-3 px-4 py-4" aria-label="编辑知识点">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="知识点标题"
          className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 font-display text-body text-primary outline-none transition-colors focus:border-accent"
          placeholder="知识点标题"
        />
        <button
          onClick={() => setPreview((p) => !p)}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-line px-2 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
        >
          {preview ? '编辑' : '预览'}
        </button>
      </div>

      {preview ? (
        <div className="md-body min-h-16 rounded-lg border border-line bg-app/50 px-3 py-2">
          <Markdown remarkPlugins={[remarkGfm]}>{content || '（空）'}</Markdown>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={Math.min(24, Math.max(6, content.split('\n').length + 1))}
          spellCheck={false}
          aria-label="知识点内容"
          className="w-full resize-y rounded-lg border border-line bg-app px-3 py-2 font-mono text-minor leading-relaxed text-primary outline-none transition-colors focus:border-accent"
          placeholder="知识点内容（Markdown）"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          aria-label="标签，逗号分隔"
          className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
          placeholder="标签，逗号分隔"
        />
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-minor text-muted transition-colors duration-150 hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          ✕ 删除
        </button>
        <span className="text-tag text-faint">记忆数据保留</span>
        {msg && <span className="text-tag text-danger">{msg}</span>}
      </div>
    </section>
  );
}
