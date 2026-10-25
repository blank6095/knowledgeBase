'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import { MEMORY_TIER_META } from '@/components/MemoryBadge';
import { MEMORY_TIER_LABELS, MEMORY_TIER_ORDER, type MemoryTier } from '@/lib/memory';

interface Stats {
  total: number;
  byTier: Record<string, number>;
  readToday: number;
  recentDocuments: { id: string; title: string; segmentCount: number; createdAt: string }[];
  suggestion?: { segmentId: string; title: string; memory: number; degree: number } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Stats>('/api/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-body text-danger">{error}</p>;
  if (!stats) return <DashboardSkeleton />;

  const dist = MEMORY_TIER_ORDER.map((t) => ({
    key: t,
    meta: MEMORY_TIER_META[t as MemoryTier],
    count: stats.byTier[t] ?? 0,
  })).filter((d) => d.count > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="fade-up flex flex-wrap items-end gap-3">
        <h1 className="font-display text-title font-semibold">概览</h1>
        <div className="flex-1" />
        <Link
          href="/import"
          className="rounded-lg bg-accent px-3.5 py-1.5 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
        >
          导入知识
        </Link>
      </div>

      {/* L3-4 今日首推：薄弱 × 图谱中心性 top1，纯规则零调用 */}
      {stats.suggestion && (
        <Link
          href={`/segments/${stats.suggestion.segmentId}`}
          className="card card-hover fade-up flex items-center gap-3 px-4 py-3"
          style={{ animationDelay: '40ms' }}
        >
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-tag text-accent">今日先看</span>
          <span className="min-w-0 flex-1 truncate text-body">{stats.suggestion.title}</span>
          <span className="shrink-0 font-mono text-tag tabular-nums text-faint">
            记忆 {Math.round(stats.suggestion.memory * 100)}% · 关联 {stats.suggestion.degree}
          </span>
        </Link>
      )}

      {/* hero 统计带：36px mono 大数字 + 12px 区块标签 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="知识点总数" value={stats.total} delay={0} />
        <StatCard label="未读" value={stats.byTier.unread ?? 0} delay={1} />
        <StatCard label={MEMORY_TIER_LABELS.strong} value={stats.byTier.strong ?? 0} delay={2} accent />
        <StatCard label="今日阅读" value={stats.readToday} delay={3} />
      </div>

      <section className="card fade-up p-4" style={{ animationDelay: '160ms' }}>
        <h2 className="text-tag uppercase text-muted">记忆程度分布</h2>
        {stats.total === 0 ? (
          <div className="mt-3">
            <p className="font-display text-card text-primary">一盏灯都还没点亮。</p>
            <p className="mt-1 text-minor text-muted">
              先<Link href="/import" className="text-accent underline underline-offset-2">导入一篇 Markdown</Link>，从第一段阅读开始。
            </p>
          </div>
        ) : (
          <>
            {/* 分段圆角分布条：hover 段显示档位与数值 */}
            <div className="mt-4 flex h-2 gap-px">
              {dist.map((d) => (
                <div key={d.key} className="group relative flex" style={{ width: `${(d.count / stats.total) * 100}%` }}>
                  <div className="w-full rounded-full transition-transform duration-150 group-hover:scale-y-125" style={{ background: d.meta.dot }} />
                  <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-elevated px-2 py-0.5 text-tag text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    {d.meta.label} <span className="font-mono tabular-nums">{d.count}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-tag">
              {dist.map((d) => (
                <span key={d.key} className="flex items-center gap-1.5 text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.meta.dot }} />
                  {d.meta.label} <span className="font-mono tabular-nums">{d.count}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card fade-up p-4" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-tag uppercase text-muted">最近导入</h2>
          <Link href="/notes" className="text-tag text-accent hover:text-accent-strong hover:underline">查看全部 →</Link>
        </div>
        {stats.recentDocuments.length === 0 ? (
          <p className="mt-3 text-minor text-muted">暂无文档</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {stats.recentDocuments.map((d, i) => (
              <li
                key={d.id}
                className="fade-up flex items-center justify-between gap-3 py-2"
                style={{ animationDelay: `${240 + i * 40}ms` }}
              >
                <Link href={`/notes/${d.id}`} className="min-w-0 flex-1 truncate text-body hover:text-accent hover:underline">
                  {d.title}
                </Link>
                <span className="shrink-0 font-mono text-tag tabular-nums text-muted">
                  <span className="font-mono">{d.segmentCount}</span> 个知识点 · {formatDate(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, accent, delay }: { label: string; value: number; accent?: boolean; delay: number }) {
  return (
    <div className="card card-hover fade-up px-4 py-3" style={{ animationDelay: `${delay * 40}ms` }}>
      <p className="text-tag uppercase text-muted">{label}</p>
      <p className={`mt-1 font-mono text-hero font-semibold tabular-nums ${accent ? 'text-accent' : 'text-primary'}`}>
        {value}
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" role="status" aria-label="加载中">
      <div className="skeleton h-9 w-32" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card px-4 py-3">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton mt-3 h-9 w-20" />
          </div>
        ))}
      </div>
      <div className="card p-4">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-4 h-2 w-full" />
      </div>
    </div>
  );
}
