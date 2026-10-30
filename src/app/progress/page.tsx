'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDuration } from '@/lib/client';
import { Skeleton } from '@/components/Skeleton';
import ErrorState from '@/components/ErrorState';
import { bestContrastForeground, compositeOver } from '@/lib/ui/contrast';
import { LIGHT_BACKGROUND_FOREGROUNDS, PALETTE } from '@/lib/ui/theme';
import type { TodayLearningItem, WeeklyLearningMetrics } from '@/lib/learning-plan';

interface DailyActivity {
  day: string;
  reviews: number;
  readingSessions: number;
  readingMs: number;
  needsReview: number;
}

interface WeeklyReport {
  summary: string;
  current: WeeklyLearningMetrics;
  previous: WeeklyLearningMetrics;
  days: DailyActivity[];
  priorityItems: TodayLearningItem[];
}

export default function ProgressPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 重试令牌：数据库抖动后无需刷新整页
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    api<WeeklyReport>('/api/learning/weekly')
      .then((data) => {
        if (!alive) return;
        setReport(data);
        setError('');
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message || '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          message={error}
          onRetry={() => setReloadToken((n) => n + 1)}
          hint="若提示数据库暂时不可用，稍后点「重试」即可；期间可以先回到「概览」继续学习。"
        />
      </div>
    );
  }
  if (!report) {
    return (
      <div className="mx-auto max-w-4xl space-y-4" role="status" aria-label="加载学习复盘">
        <Skeleton className="h-9 w-40" />
        <div className="card space-y-3 px-5 py-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  const cells = buildHeatCells(report.days);
  const hasActivity =
    report.current.reviewCount + report.current.needsReviewCount + report.current.improvedCount + report.current.activeDays > 0;
  const selectedDetail = selectedDay
    ? (() => {
        const d = report.days.find((x) => x.day === selectedDay);
        if (!d) return '';
        return `${d.day}：自测 ${d.reviews} 次，阅读 ${d.readingSessions} 次，累计 ${formatDuration(d.readingMs)}，需巩固 ${d.needsReview} 项`;
      })()
    : '';

  return (
    <div className="mx-auto max-w-4xl space-y-6 fade-up">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-title font-semibold">学习复盘</h1>
          <p className="mt-1 text-minor text-muted">只看真实行为：阅读、主动回忆、巩固与改善。</p>
        </div>
        <div className="flex-1" />
        <Link
          href="/"
          className="rounded-lg bg-accent px-3.5 py-1.5 text-body font-medium text-accent-ink hover:bg-accent-strong"
        >
          返回今日学习
        </Link>
      </div>

      <section className="card border-l-2 border-accent px-5 py-4">
        <p className="text-tag uppercase tracking-[0.16em] text-accent">近 7 天结论</p>
        <p className="mt-2 font-display text-subtitle leading-relaxed text-primary">{report.summary}</p>
      </section>

      {hasActivity && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="主动回忆" value={report.current.reviewCount} previous={report.previous.reviewCount} />
          <MetricCard label="需再巩固" value={report.current.needsReviewCount} previous={report.previous.needsReviewCount} inverse />
          <MetricCard label="有改善" value={report.current.improvedCount} previous={report.previous.improvedCount} />
          <MetricCard label="活跃天数" value={report.current.activeDays} previous={report.previous.activeDays} />
        </section>
      )}

      <section className="card px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-card font-medium text-primary">14 天学习热力</h2>
          <span className="text-tag text-muted">色块 = 阅读 + 自测活跃度 · 点格子看当天明细</span>
        </div>
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 sm:gap-2">
          {cells.map((cell) => {
            const active = cell.day.day === selectedDay;
            return (
              <button
                key={cell.day.day}
                type="button"
                onClick={() => setSelectedDay(active ? null : cell.day.day)}
                aria-pressed={active}
                aria-label={`${cell.day.day}：自测 ${cell.day.reviews} 次，阅读 ${cell.day.readingSessions} 次，${formatDuration(
                  cell.day.readingMs,
                )}`}
                className="flex h-14 w-11 shrink-0 flex-col justify-between rounded-lg border p-1.5 text-left transition-colors duration-150 sm:h-16 sm:w-12"
                style={{
                  background: cell.background,
                  borderColor: active ? PALETTE.accent : 'rgba(236, 230, 218, 0.08)',
                  color: cell.foreground,
                }}
              >
                <span className="font-mono text-tag tabular-nums" style={{ color: cell.foreground }}>
                  {cell.day.day.slice(8)}
                </span>
                <span className="font-mono text-body font-semibold tabular-nums" style={{ color: cell.foreground }}>
                  {cell.activity}
                </span>
              </button>
            );
          })}
        </div>
        {selectedDetail ? (
          <p className="mt-3 border-t border-line pt-2 text-tag text-muted" aria-live="polite">
            {selectedDetail}
          </p>
        ) : (
          <p className="mt-3 border-t border-line pt-2 text-tag text-faint">悬停或点击格子查看当天明细（键盘可用 Tab + Enter）。</p>
        )}
      </section>

      <section className="card px-5 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-card font-medium text-primary">下一步优先项</h2>
          <Link href="/" className="text-tag text-accent hover:underline">查看全部今日学习 →</Link>
        </div>
        {report.priorityItems.length === 0 ? (
          <p className="mt-3 text-minor text-muted">当前没有到期或未自测内容，可从知识库自由选择。</p>
        ) : (
            <ul className="mt-3 divide-y divide-line">
              {report.priorityItems.map((item) => (
                <li key={item.segmentId}>
                  {/* 窄屏改为两行：标题一行，原因与行动一行，避免标题被挤没 */}
                  <Link
                    href={`/study/${item.segmentId}`}
                    className="flex flex-col gap-0.5 py-3 hover:text-accent sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="min-w-0 flex-1 text-body sm:truncate">{item.title}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-tag text-muted">{item.reason}</span>
                      <span className="text-tag text-accent">开始回忆 →</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
        )}
      </section>
    </div>
  );
}

interface HeatCell {
  day: DailyActivity;
  activity: number;
  background: string;
  foreground: string;
}

/**
 * 热力格配色：底色由「卡片底 + 琥珀叠加」算出实际观感色，
 * 前景色再按对比度自动挑选（亮格用深色字），避免出现「亮底浅字看不清」。
 */
export function buildHeatCells(days: DailyActivity[]): HeatCell[] {
  return days.map((day) => {
    const activity = day.reviews + day.readingSessions;
    const alpha = activity === 0 ? 0 : Math.min(0.16 + activity * 0.12, 0.6);
    const background = compositeOver(PALETTE.surface, PALETTE.accent, alpha);
    const foreground = bestContrastForeground(background, LIGHT_BACKGROUND_FOREGROUNDS);
    return { day, activity, background, foreground };
  });
}

function MetricCard({
  label,
  value,
  previous,
  inverse = false,
}: {
  label: string;
  value: number;
  previous: number;
  inverse?: boolean;
}) {
  const delta = value - previous;
  const improved = inverse ? delta < 0 : delta > 0;
  return (
    <div className="card px-4 py-4">
      <p className="text-tag text-muted">{label}</p>
      <p className="mt-1 font-mono text-title font-semibold tabular-nums text-primary">{value}</p>
      <p className={`mt-1 text-tag ${delta === 0 ? 'text-faint' : improved ? 'text-success' : 'text-warn'}`}>
        较前 7 天 {delta === 0 ? '持平' : `${delta > 0 ? '+' : ''}${delta}`}
      </p>
    </div>
  );
}
