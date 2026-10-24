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

  if (error) return <p className="text-danger">{error}</p>;
  if (!stats) return <p className="text-muted">加载中…</p>;

  const order: (keyof typeof STATUS_META)[] = ['mastered', 'familiar', 'learning', 'new'];
  const dist = order.map((k) => ({ key: k, meta: STATUS_META[k], count: stats.byStatus[k] ?? 0 }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">概览</h1>
        <div className="flex-1" />
        <Link
          href="/import"
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/85"
        >
          导入知识
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="知识点总数" value={stats.total} />
        <Card label="建议回看" value={stats.suggestCount} accent="text-danger" />
        <Card label="已掌握" value={stats.byStatus.mastered ?? 0} accent="text-success" />
        <Card label="今日已学习" value={stats.learnedToday} />
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">掌握程度分布</h2>
        {stats.total === 0 ? (
          <p className="mt-3 text-sm text-muted">
            还没有知识点，先<Link href="/import" className="text-accent underline">导入一篇 Markdown</Link>试试。
          </p>
        ) : (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-hover">
              {dist.map(
                (d) =>
                  d.count > 0 && (
                    <div key={d.key} style={{ width: `${(d.count / stats.total) * 100}%`, background: d.meta.dot }} />
                  ),
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {dist.map((d) => (
                <span key={d.key} className="flex items-center gap-1.5 text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.meta.dot }} />
                  {d.meta.label} <span className="tabular-nums">{d.count}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">最近导入</h2>
          <Link href="/notes" className="text-xs text-accent hover:underline">查看全部 →</Link>
        </div>
        {stats.recentDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">暂无文档</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {stats.recentDocuments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/notes/${d.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent hover:underline">
                  {d.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">
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
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
