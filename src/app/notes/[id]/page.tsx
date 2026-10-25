'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import MemoryBadge from '@/components/MemoryBadge';
import { Skeleton } from '@/components/Skeleton';

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

  if (error) return <p className="text-body text-danger">{error}</p>;
  if (!data)
    return (
      <div className="mx-auto max-w-4xl space-y-4" role="status" aria-label="加载中">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-72" />
        <div className="card divide-y divide-line">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-3 w-10" />
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="fade-up">
        <Link href="/notes" className="text-tag text-faint transition-colors hover:text-accent hover:underline">← 知识库</Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-subtitle font-semibold">{data.document.title}</h1>
          <span className="font-mono text-tag tabular-nums text-faint">
            {data.document.segmentCount} 个知识点
            {data.document.storageKey && ' · 原文已备份至 R2'}
          </span>
        </div>
        {data.document.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.document.tags.map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-tag text-muted">#{t}</span>
            ))}
          </div>
        )}
      </div>

      <ul className="card fade-up divide-y divide-line overflow-hidden" style={{ animationDelay: '80ms' }}>
        {data.segments.map((s, i) => (
          <li key={s.id}>
            <Link href={`/segments/${s.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <span className="w-5 shrink-0 text-center font-mono text-tag tabular-nums text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body transition-colors duration-150 group-hover:text-accent-strong">{s.title}</p>
                {s.headingPath && s.headingPath !== s.title && (
                  <p className="truncate text-tag text-faint">{s.headingPath}</p>
                )}
              </div>
              <span className="hidden shrink-0 font-mono text-tag tabular-nums text-muted sm:block" title="阅读次数">
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
