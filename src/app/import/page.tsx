'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '@/lib/client';

interface ImportResult {
  documentId: string;
  segmentCount: number;
  linkCount: number;
}

const GRANULARITY = [
  { label: '粗', value: 2400 },
  { label: '中', value: 1200 },
  { label: '细', value: 600 },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-tag uppercase text-faint">{children}</p>;
}

export default function ImportPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [maxChars, setMaxChars] = useState(1200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const text = await file.text();
    setContent(text);
    if (!title) setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
  };

  const submit = async () => {
    setError('');
    setResult(null);
    if (!content.trim()) {
      setError('请粘贴 Markdown 内容或选择 .md 文件');
      return;
    }
    setLoading(true);
    try {
      const res = await api<ImportResult>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ title, content, filename: filename || undefined, source: filename ? 'file' : 'paste', maxChars }),
      });
      setResult(res);
      setContent('');
      setFilename('');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="fade-up">
        <h1 className="font-display text-title font-semibold">导入知识</h1>
        <p className="mt-1.5 text-body text-muted">
          支持 Markdown 文件或直接粘贴。导入后按标题层级自动拆解为知识点、提取标签与 [[双链]] 关联，原文备份到 Cloudflare R2。
        </p>
      </div>

      <div className="card fade-up space-y-6 p-5" style={{ animationDelay: '80ms' }}>
        {/* 来源 */}
        <section>
          <SectionLabel>来源</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-minor text-muted">标题（留空自动取文件名/首个标题）</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-line bg-app px-3 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
                placeholder="如：React Hooks 笔记"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-minor text-muted">选择 .md 文件</span>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt"
                onChange={onFile}
                className="w-full text-minor text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-body file:font-medium file:text-accent-ink transition-colors hover:file:bg-accent-strong"
              />
            </label>
          </div>
        </section>

        {/* 粒度 */}
        <section className="border-t border-line pt-4">
          <SectionLabel>粒度</SectionLabel>
          <div className="flex overflow-hidden rounded-lg border border-line sm:w-72">
            {GRANULARITY.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setMaxChars(g.value)}
                className={`flex-1 px-4 py-2 text-body transition-colors duration-150 ${
                  maxChars === g.value
                    ? 'bg-accent font-medium text-accent-ink'
                    : 'bg-app text-muted hover:bg-surface-hover hover:text-primary'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-tag text-faint">
            按标题层级优先拆解，超长内容降级到句子边界，代码块与表格始终保持完整。粗 ≈ 2400 字 · 中 ≈ 1200 字 · 细 ≈ 600 字
          </p>
        </section>

        {/* 内容 */}
        <section className="border-t border-line pt-4">
          <SectionLabel>内容</SectionLabel>
          <label className="block">
            <span className="mb-1 block text-minor text-muted">粘贴 Markdown</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder={'---\ntitle: 笔记标题\ntags: [前端, React]\n---\n\n## 第一节\n内容…\n\n## 第二节\n内容…'}
              className="w-full rounded-lg border border-line bg-app p-3 font-mono text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </label>
        </section>

        {error && <p className="text-body text-danger">{error}</p>}

        {result && (
          <div className="space-y-1.5 rounded-lg border border-success/25 bg-success/10 p-4">
            <p className="fade-up text-body font-medium text-success" style={{ animationDelay: '0ms' }}>
              已收入手稿。
            </p>
            <p className="fade-up text-minor text-muted" style={{ animationDelay: '40ms' }}>
              拆成 <span className="font-mono tabular-nums text-primary">{result.segmentCount}</span> 个知识点，建立{' '}
              <span className="font-mono tabular-nums text-primary">{result.linkCount}</span> 条关联，等着被逐一点亮。
            </p>
            <p className="fade-up" style={{ animationDelay: '80ms' }}>
              <Link href={`/notes/${result.documentId}`} className="mr-3 text-body text-accent underline underline-offset-2 hover:text-accent-strong">
                查看文档 →
              </Link>
              <Link href="/graph" className="text-body text-accent underline underline-offset-2 hover:text-accent-strong">
                查看关系图谱 →
              </Link>
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="rounded-lg bg-accent px-5 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          {loading ? '导入中…' : '导入'}
        </button>
      </div>
    </div>
  );
}
