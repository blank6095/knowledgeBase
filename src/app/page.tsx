'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import { STATUS_META } from '@/components/MasteryBadge';

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  suggestCount: number;
  learnedToday: number;
  recentDocuments: { id: string; title: string; segmentCount: number; createdAt: string }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Stats>('/api/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!stats) return <p className="text-slate-400">加载中…</p>;

  const order: (keyof typeof STATUS_META)[] = ['mastered', 'familiar', 'learning', 'new'];
  const dist = order.map((k) => ({ key: k, meta: STATUS_META[k], count: stats.byStatus[k] ?? 0 }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">概览</h1>
        <div className="flex-1" />
        <Link href="/import" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          导入知识
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="知识点总数" value={stats.total} />
        <Card label="建议回看" value={stats.suggestCount} accent="text-red-600" />
        <Card label="已掌握" value={stats.byStatus.mastered ?? 0} accent="text-emerald-600" />
        <Card label="今日已学习" value={stats.learnedToday} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-500">掌握程度分布</h2>
        {stats.total === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            还没有知识点，先<Link href="/import" className="text-blue-600 underline">导入一篇 Markdown</Link>试试。
          </p>
        ) : (
          <>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full">
              {dist.map(
                (d) =>
                  d.count > 0 && (
                    <div key={d.key} style={{ width: `${(d.count / stats.total) * 100}%`, background: d.meta.dot }} />
                  ),
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {dist.map((d) => (
                <span key={d.key} className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.meta.dot }} />
                  {d.meta.label} {d.count}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-500">最近导入</h2>
          <Link href="/notes" className="text-sm text-blue-600 hover:underline">查看全部 →</Link>
        </div>
        {stats.recentDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">暂无文档</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {stats.recentDocuments.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5 text-sm">
                <Link href={`/notes/${d.id}`} className="truncate font-medium hover:text-blue-600 hover:underline">
                  {d.title}
                </Link>
                <span className="ml-4 shrink-0 text-slate-400">
                  {d.segmentCount} 个知识点 · {formatDate(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
