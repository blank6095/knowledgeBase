import Link from 'next/link';
import type { TodayLearningItem, WeeklyLearningMetrics } from '@/lib/learning-plan';

type SerializedLearningItem = Omit<TodayLearningItem, 'lastViewedAt' | 'createdAt' | 'nextReviewAt'> & {
  lastViewedAt: string | null;
  createdAt: string;
  nextReviewAt: string | null;
};

export interface TodayLearningPayload {
  items: SerializedLearningItem[];
  metrics: WeeklyLearningMetrics;
  generatedAt: string;
}

/** 单条约 2–3 分钟：主动回忆「作答 + 对照答案 + 记录」的经验区间 */
const MINUTES_PER_ITEM_MIN = 2;
const MINUTES_PER_ITEM_MAX = 3;

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * 今日学习时长估算（UX-34②）：按条数汇总区间，替掉原先写死的「约 10–15 分钟」。
 * 0 条返回 null（不展示：此时空态已说明「今天没有必须复习的内容」）。
 * 纯函数，便于单测覆盖边界。
 */
export function estimateTodayDuration(itemCount: number): string | null {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return null;
  const count = Math.floor(itemCount);
  const lowMinutes = count * MINUTES_PER_ITEM_MIN;
  const highMinutes = count * MINUTES_PER_ITEM_MAX;
  if (lowMinutes < 60) return `约 ${lowMinutes}–${highMinutes} 分钟`;
  return `约 ${formatHours(lowMinutes)}–${formatHours(highMinutes)} 小时`;
}

export function TodayLearningSection({
  learning,
  error,
}: {
  learning: TodayLearningPayload | null;
  error?: string;
}) {
  if (error) {
    return (
      <section className="card border-l-2 border-danger px-5 py-4">
        <h2 className="text-card font-medium text-primary">今日学习暂不可用</h2>
        <p className="mt-1 text-minor text-danger">{error}</p>
        <Link href="/notes" className="mt-3 inline-block text-tag text-accent hover:underline">
          先去知识库选择 →
        </Link>
      </section>
    );
  }

  if (!learning) {
    return (
      <section className="card px-5 py-4" role="status" aria-label="加载今日学习">
        <div className="skeleton h-3 w-20" />
        <div className="mt-3 space-y-2">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
        </div>
      </section>
    );
  }

  const durationText = estimateTodayDuration(learning.items.length);

  return (
    <section className="card fade-up overflow-hidden border-l-2 border-accent">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <p className="text-tag uppercase tracking-[0.16em] text-accent">今日学习</p>
          <h2 className="mt-1 font-display text-subtitle font-semibold">先回忆，再看答案</h2>
        </div>
        {durationText && (
          <span className="text-tag text-faint" title="按每条约 2–3 分钟估算">
            {durationText}
          </span>
        )}
      </div>

      {learning.items.length === 0 ? (
        <div className="px-5 py-6">
          <p className="font-display text-body text-primary">今天没有必须复习的内容。</p>
          <p className="mt-1 text-minor text-muted">可以继续读一篇文档，或从知识库里主动挑一段。</p>
          <Link
            href="/notes"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent px-3.5 text-body font-medium text-accent-ink hover:bg-accent-strong"
          >
            选择知识开始
          </Link>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {learning.items.map((item, index) => (
            <li key={item.segmentId}>
              {/* 窄屏两行布局：标题完整换行，原因/来源与行动各占一行，避免标题被截断 */}
              <Link
                href={`/study/${item.segmentId}`}
                className="group flex flex-col gap-1.5 px-5 py-3.5 transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line font-mono text-tag text-muted">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-primary group-hover:text-accent-strong sm:truncate">
                      {item.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-tag text-accent">{item.reason}</span>
                      <span className="text-tag text-muted">
                        {item.documentTitle} · 记忆 {Math.round(item.memory * 100)}%
                      </span>
                    </span>
                  </span>
                </span>
                <span className="pl-10 text-tag text-accent sm:shrink-0 sm:pl-0">开始回忆 →</span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-2 border-t border-line px-5 py-3 text-tag sm:grid-cols-4">
        <Metric label="近 7 天自测" value={learning.metrics.reviewCount} />
        <Metric label="需再巩固" value={learning.metrics.needsReviewCount} />
        <Metric label="有改善" value={learning.metrics.improvedCount} />
        <Metric label="活跃天数" value={learning.metrics.activeDays} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-primary">{value}</span>
    </div>
  );
}
