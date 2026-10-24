'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, formatDate } from '@/lib/client';

interface DocRow {
  id: string;
  title: string;
  source: string;
  tags: string[];
  segmentCount: number;
  createdAt: string;
  avgMastery: number;
}

export default function NotesPage() {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api<{ documents: DocRow[] }>('/api/notes')
      .then((d) => setDocs(d.documents))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const kw = q.trim().toLowerCase();
    if (!kw) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(kw) || d.tags.some((t) => t.toLowerCase().includes(kw)));
  }, [docs, q]);

  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">知识库</h1>
        <div className="flex-1" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题或标签…"
          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
        <Link href="/import" className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
          导入
        </Link>
      </div>

      {!docs ? (
        <p className="text-slate-400">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">{docs.length === 0 ? '还没有文档，点击右上角「导入」开始。' : '没有匹配的文档。'}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((d) => (
            <li key={d.id}>
              <Link
                href={`/notes/${d.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{d.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{d.source === 'file' ? '文件' : '粘贴'}</span>
                </div>
                {d.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.tags.slice(0, 6).map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                  <span>{d.segmentCount} 个知识点</span>
                  <span>平均掌握 {Math.round((d.avgMastery ?? 0) * 100)}%</span>
                  <span className="flex-1 text-right">{formatDate(d.createdAt)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((d.avgMastery ?? 0) * 100)}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
