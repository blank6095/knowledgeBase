'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatDate, formatDue } from '@/lib/client';
import MasteryBadge, { STATUS_META } from '@/components/MasteryBadge';
import type { SegmentStatus } from '@/lib/sm2';

interface SegmentDetail {
  segment: {
    id: string;
    title: string;
    content: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    ease: number;
    intervalDays: number;
    reps: number;
    lapses: number;
    dueAt: string;
    mastery: number;
    status: string;
  };
  document: { id: string; title: string } | null;
  neighbors: { id: string; title: string; mastery: number; status: string }[];
}

export default function SegmentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SegmentDetail | null>(null);
  const [error, setError] = useState('');
  const viewed = useRef(false);

  useEffect(() => {
    api<SegmentDetail>(`/api/segments/${id}`)
      .then((d) => {
        setData(d);
        // 记录一次查看（严格模式下 ref 防止重复计数）
        if (!viewed.current) {
          viewed.current = true;
          fetch(`/api/segments/${id}/view`, { method: 'POST' }).catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-400">加载中…</p>;

  const s = data.segment;
  const meta = STATUS_META[(s.status as SegmentStatus) ?? 'new'] ?? STATUS_META.new;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/notes/${data.document?.id ?? ''}`} className="text-sm text-slate-500 hover:underline">
          ← {data.document?.title ?? '文档'}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <MasteryBadge status={s.status} mastery={s.mastery} />
        </div>
        {s.headingPath && s.headingPath !== s.title && (
          <p className="mt-1 text-sm text-slate-400">{s.headingPath}</p>
        )}
        {s.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {s.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">#{t}</span>
            ))}
          </div>
        )}
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="md-body">
          <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
        </div>
      </article>

      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-3 font-medium text-slate-500">学习状态</h2>
        <dl className="grid gap-1.5 text-slate-700 sm:grid-cols-2">
          <Row k="掌握度">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${Math.round(s.mastery * 100)}%`, background: meta.dot }} />
              </div>
              {Math.round(s.mastery * 100)}%
            </div>
          </Row>
          <Row k="查看次数">{s.viewCount} 次</Row>
          <Row k="最近查看">{formatDate(s.lastViewedAt)}</Row>
          <Row k="学习次数">{s.reps} 次（遗忘 {s.lapses} 次）</Row>
          <Row k="建议回看">{formatDue(s.dueAt)}</Row>
        </dl>
      </div>

      {data.neighbors.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-slate-500">相关知识点</h2>
          <ul className="space-y-2">
            {data.neighbors.map((n) => (
              <li key={n.id}>
                <Link href={`/segments/${n.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-blue-600">
                  <span className="truncate">{n.title}</span>
                  <MasteryBadge status={n.status} mastery={n.mastery} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
