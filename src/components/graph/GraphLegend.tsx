'use client';

/**
 * 图谱记忆度浮层图例（U1-7）。
 *
 * 默认收起为右下角「记忆度」胶囊；点击展开为 220px 浮层卡：
 * 未读圆点 + 琥珀渐变条（gradient 直接插值为 CSS linear-gradient）+ 长明圆点与文字。
 * 可再次点击卡片头部收起。配色全部来自 props（与图谱节点 memoryColor 同源），
 * 不在此处另造记忆度颜色。
 *
 * 定位依赖最近的 positioned 祖先（GraphCanvas 根节点已是 relative）；
 * 移动端抬高到 bottom-20，避开 GraphNavigation 的底部条。
 */
import { useId, useState } from 'react';

export interface GraphLegendTier {
  label: string;
  color: string;
}

export interface GraphLegendProps {
  tiers: GraphLegendTier[];
  gradient: string[];
  defaultOpen?: boolean;
}

const FALLBACK_GRADIENT = ['#55504a', '#8a6a33', '#c49144', '#f2c069'];

/** 端点兜底：正常接入时 Lead 会传入四档 tiers，这里只保证空数组不炸 */
const FALLBACK_UNREAD: GraphLegendTier = { label: '未读', color: '#55504a' };
const FALLBACK_STRONG: GraphLegendTier = { label: '长明', color: '#f2c069' };

const SHELL_CLASS =
  'pointer-events-auto absolute bottom-20 right-3 z-20 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-elevated/95 shadow-2xl backdrop-blur md:bottom-4 md:right-4';

export default function GraphLegend({
  tiers,
  gradient,
  defaultOpen = false,
}: GraphLegendProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  const unread = tiers.length > 0 ? tiers[0] : FALLBACK_UNREAD;
  const strong = tiers.length > 0 ? tiers[tiers.length - 1] : FALLBACK_STRONG;
  const barBackground =
    gradient.length >= 2
      ? `linear-gradient(to right, ${gradient.join(', ')})`
      : gradient.length === 1
        ? gradient[0]
        : `linear-gradient(to right, ${FALLBACK_GRADIENT.join(', ')})`;

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label="展开记忆度图例"
        onClick={() => setOpen(true)}
        className={`${SHELL_CLASS} inline-flex min-h-11 items-center gap-2 px-3 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary`}
      >
        <span
          aria-hidden
          className="h-2 w-10 shrink-0 rounded-full"
          style={{ background: barBackground }}
        />
        <span className="whitespace-nowrap">记忆度</span>
      </button>
    );
  }

  return (
    <section aria-label="记忆度图例" className={`${SHELL_CLASS} w-[220px] p-2.5 text-tag text-muted`}>
      <button
        type="button"
        aria-expanded={true}
        aria-controls={bodyId}
        aria-label="收起记忆度图例"
        onClick={() => setOpen(false)}
        className="flex min-h-9 w-full items-center justify-between rounded-md px-1 text-faint transition-colors duration-150 hover:text-primary"
      >
        <span>记忆度</span>
        <span aria-hidden className="inline-flex items-center gap-1">
          收起
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
          >
            <path d="m6 15 6-6 6 6" />
          </svg>
        </span>
      </button>

      <div id={bodyId} className="mt-1 flex items-center gap-2 px-1 pb-1">
        <span className="flex shrink-0 items-center gap-1">
          <i
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: unread.color }}
          />
          {unread.label}
        </span>
        <span
          aria-hidden
          className="h-2.5 min-w-0 flex-1 rounded-full"
          style={{ background: barBackground }}
        />
        <span className="flex shrink-0 items-center gap-1">
          {strong.label}
          <i
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: strong.color }}
          />
        </span>
      </div>
    </section>
  );
}
