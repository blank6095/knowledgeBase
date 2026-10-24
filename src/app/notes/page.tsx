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

  if (error) return <p className="text-danger">{error}</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">知识库</h1>
        <span className="text-xs text-muted">{docs ? `${docs.length} 篇文档` : ''}</span>
        <div className="flex-1" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题或标签…"
          className="w-48 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
        <Link
          href="/import"
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/85"
        >
          导入
        </Link>
      </div>

      {!docs ? (
        <p className="text-muted">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {docs.length === 0 ? '还没有文档，点击右上角「导入」开始。' : '没有匹配的文档。'}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {filtered.map((d) => (
            <li key={d.id}>
              <Link
                href={`/notes/${d.id}`}
                className="flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{d.title}</span>
                  {d.tags.length > 0 && (
                    <span className="ml-2 hidden space-x-1.5 lg:inline">
                      {d.tags.slice(0, 4).map((t) => (
                        <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] text-muted">
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                  <span className="h-1 w-14 overflow-hidden rounded-full bg-surface-hover">
                    <span
                      className="block h-full rounded-full bg-success"
                      style={{ width: `${Math.round((d.avgMastery ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums">掌握 {Math.round((d.avgMastery ?? 0) * 100)}%</span>
                  <span className="tabular-nums">{d.segmentCount} 点</span>
                  <span className="hidden tabular-nums sm:inline">{formatDate(d.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
