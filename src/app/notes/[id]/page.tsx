'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, formatDue } from '@/lib/client';
import MasteryBadge from '@/components/MasteryBadge';

interface DocDetail {
  document: { id: string; title: string; tags: string[]; segmentCount: number; createdAt: string; storageKey: string | null };
  segments: {
    id: string;
    title: string;
    headingPath: string;
    tags: string[];
    mastery: number;
    status: string;
    viewCount: number;
    dueAt: string;
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

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/notes" className="text-sm text-slate-500 hover:underline">← 知识库</Link>
        <h1 className="mt-2 text-2xl font-semibold">{data.document.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {data.document.segmentCount} 个知识点
          {data.document.storageKey && ' · 原文已备份至 R2'}
        </p>
        {data.document.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.document.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">#{t}</span>
            ))}
          </div>
        )}
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {data.segments.map((s, i) => (
          <li key={s.id}>
            <Link href={`/segments/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="w-6 shrink-0 text-center text-xs text-slate-300">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}</p>
                {s.headingPath && s.headingPath !== s.title && (
                  <p className="truncate text-xs text-slate-400">{s.headingPath}</p>
                )}
              </div>
              <span className="hidden shrink-0 text-xs text-slate-400 sm:block">查看 {s.viewCount} 次</span>
              <span className="shrink-0 text-xs text-slate-400">{formatDue(s.dueAt)}</span>
              <MasteryBadge status={s.status} mastery={s.mastery} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
