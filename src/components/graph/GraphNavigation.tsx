'use client';

/**
 * 图谱页悬浮导航（U1-3）。
 *
 * - 桌面（≥md）：固定于视口左侧中部，宽 56px，仅图标；hover/键盘聚焦时显示自定义
 *   中文 tooltip（不是原生 title）。
 * - 移动端（<md）：底部横向条。默认均分展示全部入口；
 *   `compactOnMobile`（图谱页）只留 3 个核心入口 +「更多」，其余收进底部抽屉，
 *   把单入口从 ~40px 提升到 ~76px，并避开 Home Indicator（bottom-safe-3）。
 * - 组件只负责渲染与导航；active 由 `item.active` 显式传入（缺省时按当前 pathname
 *   兜底推导），`disabled` 项不跳转、置灰并在 tooltip 中展示 `item.hint`。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement, SVGProps } from 'react';
import { useFocusTrap } from '@/lib/ui/focus-trap';

export interface GraphNavItem {
  key: string;
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
  /** 无 href 的入口（如打开主题面板）：点击回调 */
  onSelect?: () => void;
}

export interface GraphNavigationProps {
  items: GraphNavItem[];
  onLogout?: () => void;
  /** 移动端只保留 3 个核心入口 +「更多」抽屉；桌面左栏不受影响 */
  compactOnMobile?: boolean;
}

type IconProps = SVGProps<SVGSVGElement>;
type IconComponent = (props: IconProps) => ReactElement;

const svgProps: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** 知识宇宙：轨道 + 星核 */
const IcUniverse: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <circle cx="12" cy="12" r="2.6" />
    <ellipse cx="12" cy="12" rx="9" ry="4.1" transform="rotate(-24 12 12)" />
    <path d="M19.1 4.9v3M17.6 6.4h3" />
  </svg>
);

/** 知识库：书 + 书签 */
const IcLibrary: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
    <path d="M5 17.5h14" />
    <path d="M9 3v9l2.5-1.7L14 12V3" />
  </svg>
);

/** 今日学习：日光 */
const IcToday: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
  </svg>
);

/** 学习复盘：趋势图 */
const IcReview: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M4 19V5M4 19h16" />
    <path d="m7 15 3.2-3.6 3 2.3L20 7" />
    <path d="M16.5 7H20v3.5" />
  </svg>
);

/** AI 助手：对话 + 火花 */
const IcAssistant: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5c-1.1 0-2.2-.25-3.1-.7L5 20l1.2-4.4a7.5 7.5 0 1 1 14.3-4.1Z" />
    <path d="M9.4 9.2a2.4 2.4 0 0 1 4.7.5c0 1.5-2.3 1.8-2.3 3.1" />
    <path d="M11.8 15.3h.01" />
  </svg>
);

/** 外观主题：调色盘（U3-4 就绪前置灰占位） */
const IcTheme: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2.1-1.1 1.4-2.2-.7-1.2.2-2.8 1.7-2.8h1.3a4 4 0 0 0 4-4A9.6 9.6 0 0 0 12 3Z" />
    <circle cx="7.6" cy="11.1" r="0.9" />
    <circle cx="10" cy="7.2" r="0.9" />
    <circle cx="14.6" cy="7.6" r="0.9" />
  </svg>
);

/** 设置：齿轮 */
const IcSettings: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </svg>
);

/** 退出：门口 + 右箭头 */
const IcLogout: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

/** 移动端「更多」入口：横向省略号 */
const IcMore: IconComponent = (p) => (
  <svg {...svgProps} {...p}>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
);

/** 紧凑模式下保留在底部条的核心入口（其余进「更多」抽屉） */
export const MOBILE_CORE_KEYS = ['universe', 'library', 'assistant'];

/**
 * 移动端底部条是否展示该入口：非紧凑模式全部平铺，紧凑模式只留核心 3 项，
 * 其余收进「更多」抽屉（桌面左栏不受影响，始终展示全部）。
 * 抽成纯函数，便于单测锁定「移动端可见项 = 3 核心 +「更多」」这一 UX-01 结构约束。
 */
export function isCompactBarItem(key: string, compactOnMobile: boolean): boolean {
  return !compactOnMobile || MOBILE_CORE_KEYS.includes(key);
}

/** key 语义 → 图标；未知 key 再按 href 兜底，最后用知识宇宙图标 */
const ICON_BY_KEY: Record<string, IconComponent> = {
  universe: IcUniverse,
  graph: IcUniverse,
  library: IcLibrary,
  knowledge: IcLibrary,
  notes: IcLibrary,
  today: IcToday,
  study: IcToday,
  review: IcReview,
  progress: IcReview,
  assistant: IcAssistant,
  ask: IcAssistant,
  ai: IcAssistant,
  theme: IcTheme,
  appearance: IcTheme,
  settings: IcSettings,
};

const ICON_BY_HREF: Record<string, IconComponent> = {
  '/': IcUniverse,
  '/graph': IcUniverse,
  '/notes': IcLibrary,
  '/study': IcToday,
  '/progress': IcReview,
  '/ask': IcAssistant,
  '/settings': IcSettings,
};

function resolveIcon(item: GraphNavItem): IconComponent {
  return ICON_BY_KEY[item.key] ?? (item.href ? ICON_BY_HREF[item.href] : undefined) ?? IcUniverse;
}

/** active 兜底：显式 item.active 优先；否则按 pathname 精确/前缀匹配 */
function matchesPath(pathname: string, href?: string): boolean {
  if (!href) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TOOLTIP_CLASS = [
  'pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[11rem] -translate-x-1/2',
  'rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-left text-tag text-primary opacity-0 shadow-xl',
  'transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
  'md:bottom-auto md:left-full md:top-1/2 md:mb-0 md:ml-2 md:max-w-[16rem] md:-translate-y-1/2 md:translate-x-0',
].join(' ');

/**
 * 图谱页悬浮导航。桌面为左侧中部竖向窄栏，<md 为底部横向条。
 * 退出按钮仅在传入 onLogout 时渲染（放在底部/末端分组）。
 */
export default function GraphNavigation({ items, onLogout, compactOnMobile = false }: GraphNavigationProps) {
  const pathname = usePathname() ?? '/';
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // 抽屉打开时：聚焦首个入口、Tab 在抽屉内循环、Esc 关闭并把焦点还原到「更多」按钮（UX-16）
  useFocusTrap({
    active: compactOnMobile && sheetOpen,
    containerRef: sheetRef,
    onEscape: () => setSheetOpen(false),
  });

  // 视口切到桌面（≥md）时抽屉已被 CSS 隐藏，同步关闭，避免焦点陷阱困在不可见面板里
  useEffect(() => {
    if (!sheetOpen) return;
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (media.matches) setSheetOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [sheetOpen]);

  return (
    <>
      <nav
      aria-label="知识宇宙导航"
      className="pointer-events-auto fixed bottom-safe-3 left-safe-3 right-safe-3 z-30 flex items-center rounded-2xl border border-line bg-surface/80 p-1.5 shadow-2xl backdrop-blur-xl md:bottom-auto md:left-3 md:right-auto md:top-1/2 md:w-14 md:-translate-y-1/2 md:flex-col md:items-stretch"
    >
      <ul className="flex min-w-0 flex-1 items-center justify-between gap-0 sm:gap-0.5 md:flex-col md:gap-1">
        {items.map((item) => {
          const active = item.active ?? matchesPath(pathname, item.href);
          const disabled = Boolean(item.disabled);
          const Icon = resolveIcon(item);
          const ariaLabel = item.hint ? `${item.label}（${item.hint}）` : item.label;
          const itemClass = [
            // 移动端：宽度交给 li 均分（w-full），避免固定 44px 在 320px 屏上互相重叠；
            // md 起恢复 44×44 的固定图标格。
            'relative flex h-11 w-full min-w-0 items-center justify-center rounded-xl transition-colors duration-150 md:w-11 md:flex-none',
            disabled
              ? 'cursor-not-allowed text-faint-decor/70'
              : active
                ? 'bg-accent/10 text-accent hover:bg-accent/15'
                : 'text-muted hover:bg-surface-hover hover:text-primary',
          ].join(' ');
          const marker = active && !disabled ? (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 hidden h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent md:block"
            />
          ) : null;

          return (
            <li
              key={item.key}
              className={`group relative min-w-0 flex-1 justify-center md:flex-none ${
                isCompactBarItem(item.key, compactOnMobile) ? 'flex' : 'hidden md:flex'
              }`}
            >
              {item.href && !disabled ? (
                <Link
                  href={item.href}
                  aria-label={ariaLabel}
                  aria-current={active ? 'page' : undefined}
                  className={itemClass}
                >
                  {marker}
                  <Icon className="h-5 w-5" />
                </Link>
              ) : (
                <button
                  type="button"
                  aria-label={ariaLabel}
                  aria-current={active ? 'page' : undefined}
                  aria-disabled={disabled || undefined}
                  onClick={disabled ? (event) => event.preventDefault() : item.onSelect}
                  className={itemClass}
                >
                  {marker}
                  <Icon className="h-5 w-5" />
                </button>
              )}

              <div role="tooltip" className={TOOLTIP_CLASS}>
                {item.label}
                {item.hint && (
                  <span className="mt-0.5 block text-[0.65rem] leading-snug text-faint">
                    {item.hint}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {compactOnMobile && (
          <li className="flex min-w-0 flex-1 justify-center md:hidden">
            <button
              type="button"
              aria-label="更多导航"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className="relative flex h-11 w-full min-w-0 items-center justify-center rounded-xl text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              <IcMore className="h-5 w-5" />
            </button>
          </li>
        )}
      </ul>

      {onLogout && (
        <div
          className={`${
            compactOnMobile ? 'hidden md:flex' : 'flex'
          } ml-0 w-10 shrink-0 items-center justify-center border-l border-line md:mt-1 md:w-full md:border-l-0 md:border-t md:pt-1`}
        >
          <div className="group relative flex w-full justify-center">
            <button
              type="button"
              aria-label="退出登录"
              onClick={() => onLogout()}
              className="flex h-11 w-full items-center justify-center rounded-xl text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-danger md:w-11 md:min-w-11"
            >
              <IcLogout className="h-5 w-5" />
            </button>
            <div role="tooltip" className={TOOLTIP_CLASS}>
              退出登录
            </div>
          </div>
        </div>
      )}
      </nav>

      {/* 移动端「更多」抽屉：非核心入口与退出集中到底部面板；桌面不渲染 */}
      {compactOnMobile && sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="关闭更多导航"
            tabIndex={-1}
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="更多导航"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-elevated px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
          >
            <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            <ul className="space-y-1">
              {items.map((item) => {
                const active = item.active ?? matchesPath(pathname, item.href);
                const disabled = Boolean(item.disabled);
                const Icon = resolveIcon(item);
                const rowClass = `flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-body transition-colors duration-150 ${
                  disabled
                    ? 'cursor-not-allowed text-faint-decor/70'
                    : active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-surface-hover hover:text-primary'
                }`;
                return (
                  <li key={item.key}>
                    {item.href && !disabled ? (
                      <Link
                        href={item.href}
                        className={rowClass}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setSheetOpen(false)}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {active && <span className="text-tag text-accent">当前</span>}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          item.onSelect?.();
                          setSheetOpen(false);
                        }}
                        className={rowClass}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                        {item.hint && <span className="text-tag text-faint">{item.hint}</span>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  onLogout();
                }}
                className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-body text-danger transition-colors duration-150 hover:bg-danger/10"
              >
                <IcLogout className="h-5 w-5" />
                退出登录
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
