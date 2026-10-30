'use client';

/**
 * 概览「行动面板」：概览页只做路由入口，面板与各区块集中在这里，
 * 以便在不引入 DOM 测试环境的前提下，用 react-dom/server 逐块验证渲染结果。
 *
 * 信息层级（自上而下）：
 * 1. 行动（视觉最重）：今日先看 → 薄弱清单 → 未读精选，先回答「现在该读什么」；
 * 2. 入口（次级）：最近导入、图谱入口，供继续探索；
 * 3. 统计（最轻）：底部降权统计带，只作背景数字，不与行动争视觉。
 * 掌握度颜色唯一来源为 MEMORY_TIER_META 四档点色（规范见 MemoryBadge.tsx）；
 * 本面板不按连续记忆度取色，也不再有记忆程度四色分布条。
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import MemoryBadge, { MEMORY_TIER_META } from '@/components/MemoryBadge';
import { TodayLearningSection, type TodayLearningPayload } from '@/components/TodayLearningPanel';
import ErrorState from '@/components/ErrorState';
import { MEMORY_TIER_LABELS } from '@/lib/memory';

export interface WeakSegment {
  segmentId: string;
  title: string;
  memory: number;
  degree: number;
}

export interface UnreadSegment {
  segmentId: string;
  title: string;
  documentId: string;
  documentTitle: string;
  createdAt: string;
}

export interface RecentDocument {
  id: string;
  title: string;
  segmentCount: number;
  createdAt: string;
}

export interface StatsPayload {
  total: number;
  byTier: Record<string, number>;
  readToday: number;
  recentDocuments: RecentDocument[];
  suggestion?: WeakSegment | null;
  weakTop3?: WeakSegment[];
  unreadTop3?: UnreadSegment[];
}

/** 取数入口：唯一与 /api/stats 耦合的一行，便于测试直接替换 */
export function loadStats(): Promise<StatsPayload> {
  return api<StatsPayload>('/api/stats');
}

/**
 * 订阅一次统计数据：成功回调 onData，失败回调 onError（错误信息交给界面）。
 * 返回清理函数：卸载后到达的响应会被丢弃，避免对已卸载组件 setState。
 */
export function subscribeStats(
  onData: (data: StatsPayload) => void,
  onError: (message: string) => void,
): () => void {
  let alive = true;
  loadStats()
    .then((data) => {
      if (alive) onData(data);
    })
    .catch((e: Error) => {
      if (alive) onError(e.message);
    });
  return () => {
    alive = false;
  };
}

export function loadTodayLearning(): Promise<TodayLearningPayload> {
  return api<TodayLearningPayload>('/api/learning/today');
}

export default function DashboardPanel() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState('');
  const [learning, setLearning] = useState<TodayLearningPayload | null>(null);
  const [learningError, setLearningError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => subscribeStats(setStats, setError), [reloadToken]);
  useEffect(() => {
    let alive = true;
    loadTodayLearning()
      .then((data) => {
        if (alive) setLearning(data);
      })
      .catch((reason: Error) => {
        if (alive) setLearningError(reason.message);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  return (
    <DashboardShell
      stats={stats}
      error={error}
      learning={learning}
      learningError={learningError}
      onRetry={() => setReloadToken((n) => n + 1)}
    />
  );
}

/** 三态外壳：错误 → 可重试提示；加载中 → 骨架屏；就绪 → 行动面板 */
export function DashboardShell({
  stats,
  error,
  learning,
  learningError,
  onRetry,
}: {
  stats: StatsPayload | null;
  error: string;
  learning?: TodayLearningPayload | null;
  learningError?: string;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          message={error}
          onRetry={onRetry}
          hint="若提示数据库暂时不可用，稍后点「重试」即可；期间可以先到「知识库」继续阅读。"
        />
      </div>
    );
  }
  return stats ? <DashboardView stats={stats} learning={learning} learningError={learningError} /> : <DashboardSkeleton />;
}

/** 数据就绪后的完整面板；空库走引导导入，其余四块行动 + 降权统计带 */
export function DashboardView({
  stats,
  learning,
  learningError,
}: {
  stats: StatsPayload;
  learning?: TodayLearningPayload | null;
  learningError?: string;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader />
      {stats.total === 0 ? (
        <EmptyLibrary />
      ) : (
        <>
          {learning !== undefined ? (
            <TodayLearningSection learning={learning} error={learningError} />
          ) : (
            stats.suggestion && <TodayCard segment={stats.suggestion} />
          )}
          <WeakSection items={stats.weakTop3 ?? []} />
          <UnreadSection items={stats.unreadTop3 ?? []} />
          <RecentSection documents={stats.recentDocuments} />
          <StatsBand
            total={stats.total}
            unread={stats.byTier.unread ?? 0}
            strong={stats.byTier.strong ?? 0}
            readToday={stats.readToday}
          />
        </>
      )}
    </div>
  );
}

export function PageHeader() {
  return (
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
  );
}

export function EmptyLibrary() {
  return (
    <section className="card fade-up px-5 py-6" style={{ animationDelay: '40ms' }}>
      <p className="font-display text-card text-primary">一盏灯都还没点亮。</p>
      <p className="mt-1 text-minor text-muted">先导入一篇 Markdown，从第一段阅读开始。</p>
      <Link
        href="/import"
        className="mt-4 inline-flex rounded-lg bg-accent px-3.5 py-1.5 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
      >
        导入一篇 Markdown
      </Link>
    </section>
  );
}

export function TodayCard({ segment }: { segment: WeakSegment }) {
  return (
    <Link
      href={`/segments/${segment.segmentId}`}
      className="card card-hover fade-up flex items-center gap-3 border-l-2 border-accent px-5 py-4"
      style={{ animationDelay: '40ms' }}
    >
      <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-tag text-accent">今日先看</span>
      <span className="min-w-0 flex-1 truncate text-subtitle font-medium">{segment.title}</span>
      <span className="hidden shrink-0 font-mono text-tag tabular-nums text-faint sm:inline">
        记忆 {Math.round(segment.memory * 100)}% · 关联 {segment.degree}
      </span>
    </Link>
  );
}

export function WeakSection({ items }: { items: WeakSegment[] }) {
  return (
    <section className="card fade-up p-4" style={{ animationDelay: '80ms' }}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-card font-medium text-primary">薄弱清单</h2>
        <p className="text-tag text-muted">按遗忘风险 × 关联度排序</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-minor text-muted">暂无薄弱项（已读且未到明亮档）</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((s) => (
            <li key={s.segmentId}>
              <Link href={`/segments/${s.segmentId}`} className="group flex items-center gap-2.5 py-2 text-body">
                <MemoryBadge memory={s.memory} />
                <span className="min-w-0 flex-1 truncate transition-colors duration-150 group-hover:text-accent">
                  {s.title}
                </span>
                <span className="shrink-0 font-mono text-tag tabular-nums text-faint">
                  {Math.round(s.memory * 100)}% · 关联 {s.degree}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UnreadSection({ items }: { items: UnreadSegment[] }) {
  return (
    <section className="card fade-up p-4" style={{ animationDelay: '120ms' }}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-card font-medium text-primary">未读精选</h2>
        <p className="text-tag text-muted">最新导入里还没点亮的</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-minor text-muted">没有未读段落了</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((s) => (
            <li key={s.segmentId}>
              <Link href={`/segments/${s.segmentId}`} className="group flex items-start gap-2.5 py-2">
                <span
                  aria-hidden
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: MEMORY_TIER_META.unread.dot }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body transition-colors duration-150 group-hover:text-accent">
                    {s.title}
                  </span>
                  <span className="block truncate text-tag text-faint">{s.documentTitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecentSection({ documents }: { documents: RecentDocument[] }) {
  return (
    <section className="card fade-up p-4" style={{ animationDelay: '160ms' }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-medium text-primary">最近导入</h2>
        <Link href="/notes" className="shrink-0 text-tag text-accent hover:text-accent-strong hover:underline">
          查看全部 →
        </Link>
      </div>
      {documents.length === 0 ? (
        <p className="mt-3 text-minor text-muted">暂无文档</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <Link
                href={`/notes/${d.id}`}
                className="min-w-0 flex-1 truncate text-body hover:text-accent hover:underline"
              >
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
  );
}

export function StatsBand({
  total,
  unread,
  strong,
  readToday,
}: {
  total: number;
  unread: number;
  strong: number;
  readToday: number;
}) {
  return (
    <section className="card fade-up px-4 py-3" style={{ animationDelay: '200ms' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:items-baseline">
          <StatItem label="知识点总数" value={total} />
          <StatItem label="未读" value={unread} />
          <StatItem label={MEMORY_TIER_LABELS.strong} value={strong} accent />
          <StatItem label="今日阅读" value={readToday} />
        </dl>
        <Link
          href="/graph"
          className="shrink-0 text-tag text-accent transition-colors duration-150 hover:text-accent-strong hover:underline"
        >
          在图谱中查看掌握分布 →
        </Link>
      </div>
    </section>
  );
}

export function StatItem({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-tag uppercase text-muted">{label}</dt>
      <dd className={`font-mono text-body font-semibold tabular-nums ${accent ? 'text-accent' : 'text-primary'}`}>
        {value}
      </dd>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" role="status" aria-label="加载中">
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-9 w-32" />
        <div className="skeleton h-8 w-20" />
      </div>
      <div className="card px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-16 shrink-0" />
          <div className="skeleton h-5 min-w-0 flex-1" />
        </div>
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card space-y-2 p-4">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-3 w-40" />
          <div className="skeleton h-9 w-full" />
          <div className="skeleton h-9 w-full" />
        </div>
      ))}
      <div className="card px-4 py-3">
        <div className="skeleton h-10 w-full" />
      </div>
    </div>
  );
}
