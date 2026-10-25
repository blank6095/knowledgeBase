'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import MemoryBadge from '@/components/MemoryBadge';

interface DocDetail {
  document: { id: string; title: string; tags: string[]; segmentCount: number; createdAt: string; storageKey: string | null };
  segments: {
    id: string;
    title: string;
    headingPath: string;
    tags: string[];
    memory: number;
    viewCount: number;
  }[];
}

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DocDetail>(`/api/notes/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">加载中…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href="/notes" className="text-xs text-muted hover:text-accent hover:underline">← 知识库</Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{data.document.title}</h1>
          <span className="text-xs text-muted">
            {data.document.segmentCount} 个知识点
            {data.document.storageKey && ' · 原文已备份至 R2'}
          </span>
        </div>
        {data.document.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.document.tags.map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] text-muted">#{t}</span>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {data.segments.map((s, i) => (
          <li key={s.id}>
            <Link href={`/segments/${s.id}`} className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-hover">
              <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted/50">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.title}</p>
                {s.headingPath && s.headingPath !== s.title && (
                  <p className="truncate text-[11px] text-muted/70">{s.headingPath}</p>
                )}
              </div>
              <span className="hidden shrink-0 text-[11px] tabular-nums text-muted sm:block" title="阅读次数">
                {s.viewCount} 次
              </span>
              <MemoryBadge memory={s.memory} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
