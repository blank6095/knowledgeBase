'use client';

/**
 * 图谱搜索浮层（U2-2）与空结果态（U2-5）。
 *
 * 纯展示 + 键盘交互组件：query / results / total 全部由容器传入，
 * 本组件不建索引、不发请求、不改 nodes/links —— 匹配算法在
 * `@/lib/graph/graph-search`（U2-1），容器负责把 SearchHit 映射成
 * 已本地化的 `GraphSearchHitView`。
 *
 * 行为：
 * - Ctrl/Cmd+K 全局切换打开（浮层关闭时监听仍生效）；
 * - 打开后自动 focus 输入框；↑/↓ 循环高亮、Enter 选中、Esc 调 onClear 并关闭；
 * - 输入变化时高亮重置到 0；点击结果即选中；
 * - 空结果用 InlineFeedback 提示「没有找到匹配知识」，图谱保持可见
 *   （本组件只渲染顶部浮层，不铺全屏遮罩）；query 为空时显示引导文案。
 *
 * 定位依赖最近的 positioned 祖先（KnowledgeUniverse 根节点已是 relative）。
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import InlineFeedback from '@/components/InlineFeedback';

/** 搜索结果的一行展示数据；reason 是容器已本地化的匹配原因，如「标题」「标签」。 */
export interface GraphSearchHitView {
  id: string;
  title: string;
  reason: string;
  detail?: string;
}

export interface GraphSearchProps {
  open: boolean;
  query: string;
  results: GraphSearchHitView[];
  /** 当前可见节点总数（空态/提示文案用） */
  total: number;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}

/** 输入框复用顶栏搜索按钮的同一布局槽位与外观，结果区独立绝对定位。 */
const ROOT_CLASS =
  'pointer-events-auto relative z-30 w-full md:min-w-[360px] md:max-w-[560px] lg:min-w-[480px]';
const SHELL_CLASS =
  'flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface/65 px-3 text-left text-minor text-faint shadow-lg backdrop-blur-xl';
const DROPDOWN_CLASS =
  'absolute right-0 top-[calc(100%+0.5rem)] w-[min(560px,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line-strong bg-surface/90 shadow-2xl backdrop-blur-xl md:left-1/2 md:right-auto md:-translate-x-1/2';

/** 与 GraphTopBar 搜索位一致的键位提示视觉。 */
const KBD_CLASS =
  'rounded border border-line bg-app/60 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-faint';

function SearchIcon() {
  return (
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
}

export default function GraphSearch({
  open,
  query,
  results,
  total,
  onOpenChange,
  onQueryChange,
  onSelect,
  onClear,
}: GraphSearchProps) {
  /** 高亮下标；输入变化时归零，长度变化时在渲染期钳制，避免越界。 */
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const hasQuery = query.trim().length > 0;
  const activeIndex = results.length === 0 ? -1 : Math.min(Math.max(highlighted, 0), results.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const summary = !hasQuery
    ? `共 ${total} 个知识点`
    : results.length === 0
      ? '0 条结果'
      : `${results.length} 条结果 · 共 ${total} 个知识点`;

  // 全局快捷键：Ctrl/Cmd+K 切换；Esc 在浮层打开时清除并关闭。
  // 监听常驻（open=false 时仍可唤起），因此不能随浮层一起卸载。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (open && event.key === 'Escape') {
        event.preventDefault();
        onClear();
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, onClear]);

  // 打开时聚焦输入框（autoFocus 之外再用 ref 兜底，避免重复挂载丢焦点）。
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 浮层打开时，点击浮层以外（图谱画布、顶栏入口等）只关闭，不清除关键词。
  // 用 click 而非 pointerdown：顶栏入口的 onClick 先执行，这里再收敛为关闭。
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open, onOpenChange]);

  // 键盘切换高亮时把当前项滚入可视区（结果可能超过 max-h）。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listboxId]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const hit = results[activeIndex];
      if (hit) onSelect(hit.id);
    }
  };

  if (!open) return null;

  return (
    <section
      ref={panelRef}
      aria-label="搜索知识"
      className={ROOT_CLASS}
    >
      <div data-testid="graph-search-shell" className={SHELL_CLASS}>
        <SearchIcon />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-label="搜索知识"
          aria-expanded={results.length > 0}
          aria-controls={results.length > 0 ? listboxId : undefined}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          autoComplete="off"
          spellCheck={false}
          placeholder="搜索知识、概念、标签…"
          value={query}
          onChange={(event) => {
            setHighlighted(0);
            onQueryChange(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          style={{ outline: 'none' }}
          className="h-full min-w-0 flex-1 bg-transparent text-minor text-primary outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <span aria-hidden className="hidden shrink-0 items-center gap-1 sm:flex">
          <kbd className={KBD_CLASS}>Ctrl</kbd>
          <kbd className={KBD_CLASS}>K</kbd>
        </span>
      </div>

      <div className={DROPDOWN_CLASS}>
      {results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="搜索结果"
          className="max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain p-1.5"
        >
          {results.map((hit, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={hit.id}
                id={optionId(index)}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(hit.id)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 ${
                  active ? 'bg-accent/10' : 'hover:bg-surface-hover/60'
                }`}
              >
                <span
                  aria-hidden
                  className={`h-7 w-0.5 shrink-0 rounded-full transition-colors duration-150 ${
                    active ? 'bg-accent' : 'bg-transparent'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-body ${active ? 'text-primary' : 'text-muted'}`}>
                    {hit.title}
                  </span>
                  <span className="mt-0.5 block truncate text-tag text-faint">
                    命中 · {hit.reason}
                    {hit.detail ? ` · ${hit.detail}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hasQuery && results.length === 0 && (
        <div className="px-3 py-3">
          <InlineFeedback tone="warn">没有找到匹配知识</InlineFeedback>
          <p className="mt-1 text-tag text-faint">共 {total} 个知识点，试试更短的关键词。</p>
        </div>
      )}

      {!hasQuery && (
        <div className="px-3 py-3">
          <p className="text-minor text-muted">搜索标题 / 标签 / 摘要，Enter 聚焦，Esc 清除</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-tag text-faint">
        <p role="status">{summary}</p>
        <p aria-hidden className="hidden shrink-0 sm:block">
          ↑↓ 切换 · Enter 选中 · Esc 清除
        </p>
      </div>
      </div>
    </section>
  );
}
