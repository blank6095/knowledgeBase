'use client';

/**
 * 图谱页顶部悬浮条（U1-4）。
 *
 * 左：产品标识「✦ 知识宇宙」；中：搜索位（U1-4 只做入口，点击回传 onSearchClick，
 * 搜索浮层与键盘交互属 U2-2）；右：知识点/关系统计，fixture 压测模式额外显示徽标。
 *
 * 外层 pointer-events-none，只有搜索按钮可交互，避免悬浮条遮挡画布拖拽。
 * 定位依赖最近的 positioned 祖先（GraphCanvas 根节点已是 relative）。
 */

export interface GraphTopBarProps {
  nodeCount: number;
  edgeCount: number;
  fixture?: string | null;
  searchHint?: string;
  onSearchClick?: () => void;
}

const DEFAULT_SEARCH_HINT = '搜索知识、概念、标签…';

const IcSearch = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="h-4 w-4 shrink-0 text-muted"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);

export default function GraphTopBar({
  nodeCount,
  edgeCount,
  fixture,
  searchHint,
  onSearchClick,
}: GraphTopBarProps) {
  const hint = searchHint ?? DEFAULT_SEARCH_HINT;

  return (
    <header
      aria-label="知识宇宙顶栏"
      className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-center gap-2 md:left-20 md:right-4 md:gap-3"
    >
      {/* 产品标识 */}
      <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-2.5 py-2 backdrop-blur-xl md:px-3">
        <span aria-hidden className="text-body leading-none text-accent">
          ✦
        </span>
        <span className="font-display text-minor font-semibold tracking-wide text-primary">
          知识宇宙
        </span>
      </div>

      {/* 搜索位：占位文案 + Ctrl K；点击回传，本体属 U2-2 */}
      <div className="flex min-w-0 flex-1 justify-center md:px-2">
        <button
          type="button"
          onClick={() => onSearchClick?.()}
          aria-label="搜索知识（Ctrl K）"
          className="pointer-events-auto flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface/65 px-3 text-left text-minor text-faint shadow-lg backdrop-blur-xl transition-colors duration-150 hover:border-line-strong hover:bg-surface-hover/70 hover:text-muted md:min-w-[360px] md:max-w-[560px] lg:min-w-[480px]"
        >
          <IcSearch />
          <span className="min-w-0 flex-1 truncate">{hint}</span>
          <span aria-hidden className="hidden shrink-0 items-center gap-1 sm:flex">
            <kbd className="rounded border border-line bg-app/60 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-faint">
              Ctrl
            </kbd>
            <kbd className="rounded border border-line bg-app/60 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-faint">
              K
            </kbd>
          </span>
        </button>
      </div>

      {/* 统计 + 压测徽标 */}
      <div className="flex shrink-0 items-center gap-2">
        {fixture && (
          <span
            title={`压测数据模式：${fixture}`}
            aria-label={`压测数据模式：${fixture}`}
            className="inline-flex max-w-[9rem] items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-tag font-medium text-warn"
          >
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            <span className="truncate">
              <span className="md:hidden">压测</span>
              <span className="hidden md:inline">压测 · {fixture}</span>
            </span>
          </span>
        )}
        <p className="hidden whitespace-nowrap text-tag text-muted lg:block">
          <span className="font-mono tabular-nums text-primary">{nodeCount}</span> 知识点
          <span aria-hidden className="mx-1 text-faint-decor">
            ·
          </span>
          <span className="font-mono tabular-nums text-primary">{edgeCount}</span> 关系
        </p>
      </div>
    </header>
  );
}
