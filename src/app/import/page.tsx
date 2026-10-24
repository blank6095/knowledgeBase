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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">导入知识</h1>
      <p className="text-sm text-slate-500">
        支持 Markdown 文件或直接粘贴。导入后按标题层级自动拆解为知识点、提取标签与 [[双链]] 关联，原文备份到 Cloudflare R2。
      </p>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">标题（留空自动取文件名/首个标题）</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
              placeholder="如：React Hooks 笔记"
            />
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block text-slate-600">拆分粒度</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              {GRANULARITY.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setMaxChars(g.value)}
                  className={`flex-1 px-4 py-2 transition-colors ${
                    maxChars === g.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              按标题层级优先拆解，超长内容降级到句子边界，代码块与表格始终保持完整。粗 ≈ 2400 字 · 中 ≈ 1200 字 · 细 ≈ 600 字
            </p>
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">选择 .md 文件</span>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt"
            onChange={onFile}
            className="w-full text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white hover:file:bg-slate-700"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">或粘贴 Markdown 内容</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder={'---\ntitle: 笔记标题\ntags: [前端, React]\n---\n\n## 第一节\n内容…\n\n## 第二节\n内容…'}
            className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs outline-none focus:border-slate-900"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            导入成功：分割出 <b>{result.segmentCount}</b> 个知识点，建立 <b>{result.linkCount}</b> 条关联。
            <Link href={`/notes/${result.documentId}`} className="ml-2 font-medium underline">查看文档 →</Link>
            <Link href="/graph" className="ml-3 font-medium underline">查看关系图谱 →</Link>
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? '导入中…' : '导入'}
        </button>
      </div>
    </div>
  );
}
