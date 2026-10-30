'use client';

/**
 * 节点右键 / 长按菜单（U4-5）。
 *
 * 纯受控展示组件：坐标、标题、菜单动作与关闭回调全部由容器传入；
 * 本组件不监听画布节点、不自行计算锚点节点、不发请求。
 * 容器在节点上触发 `contextmenu`（桌面右键）或长按定时器（移动端）后，
 * 用视口坐标 (clientX/clientY) 条件渲染本组件即可。
 *
 * 行为：
 * - fixed 浮层宽 224px（w-56），矩形经 `clampPopover` 做视口夹取，
 *   下方空间不足时自动翻到上方/贴边，保证不越界；
 * - role="menu" + role="menuitem"；打开聚焦首个可用项，
 *   ↑/↓ 在可用项间循环、Home/End 跳首尾、Enter 执行、Esc 关闭；
 * - 点击菜单外（document click）关闭；不阻止/不吞掉任何原生事件；
 * - disabled 项 aria-disabled 且不可聚焦/不可点，并展示 hint 文本；
 * - 菜单项 min-h-11（G17 触控目标 ≥44px），不依赖 hover，兼容触控。
 *
 * 定位基于 `position: fixed` 与视口坐标，因此祖先节点不可有
 * transform / filter / contain: paint 等会改变 fixed containing block 的样式。
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clampPopover } from '@/lib/ui/geometry';

export interface GraphContextMenuAction {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface GraphContextMenuProps {
  /** 视口坐标（clientX） */
  x: number;
  /** 视口坐标（clientY） */
  y: number;
  /** 节点标题（菜单头部，超长截断） */
  title: string;
  actions: GraphContextMenuAction[];
  onClose: () => void;
}

/** 浮层宽度（px）：与 w-56 一致，同时作为 clampPopover 的碰撞尺寸。 */
const MENU_WIDTH = 224;
/** 单个菜单项高度（px）：min-h-11 = 44px（G17 口径）。 */
const ITEM_HEIGHT = 44;
/** 菜单内部上下内边距（px）：p-2 × 2。 */
const MENU_PADDING_Y = 16;
/** 与视口边缘的最小间距（px）。 */
const VIEWPORT_MARGIN = 8;

export default function GraphContextMenu({ x, y, title, actions, onClose }: GraphContextMenuProps) {
  const titleId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusedOnMount = useRef(false);
  /** 视口尺寸：SSR 阶段没有 window，先按锚点原样渲染，挂载后再夹取。 */
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // 视口尺寸与方向变化时重新夹取（fixed 坐标是视口坐标，缩放/转屏需重算）。
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // 打开时聚焦首个可用项；全部禁用时聚焦菜单容器，保证 Esc 仍可用。
  // 只做一次：父级重渲染传入新的 actions 数组时不打断方向键导航。
  useEffect(() => {
    if (focusedOnMount.current) return;
    focusedOnMount.current = true;
    const firstEnabled = actions.findIndex((action) => !action.disabled);
    const target = firstEnabled >= 0 ? itemRefs.current[firstEnabled] : menuRef.current;
    target?.focus();
  }, [actions]);

  // 点击菜单外关闭。监听在挂载后才注册（effect 晚于打开菜单的那次事件），
  // 且不调用 preventDefault/stopPropagation，避免吞掉触发打开或点击画布的首次事件。
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      // 已因选择动作而卸载时，不再重复回调关闭。
      if (!menuRef.current) return;
      const target = event.target;
      if (target instanceof Node && menuRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [onClose]);

  const measured = viewport.width > 0 && viewport.height > 0;
  // 契约口径：height = actions.length * 44 + 16（标题栏高度不计入估算）。
  const estimatedHeight = actions.length * ITEM_HEIGHT + MENU_PADDING_Y;
  const position = measured
    ? clampPopover({
        anchorX: x,
        anchorY: y,
        width: MENU_WIDTH,
        height: estimatedHeight,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        margin: VIEWPORT_MARGIN,
        placement: 'bottom',
      })
    : { left: x, top: y };
  // 实际高度可能略高于估算（标题栏 + 带 hint 的两行项），
  // 用 maxHeight 兜底，确保内容再长也不会越过视口底边。
  const maxHeight = measured
    ? Math.max(ITEM_HEIGHT * 2, viewport.height - position.top - VIEWPORT_MARGIN)
    : undefined;

  const enabledIndexes = actions.reduce<number[]>((indexes, action, index) => {
    if (!action.disabled) indexes.push(index);
    return indexes;
  }, []);

  const focusedIndex = () => itemRefs.current.findIndex((item) => item === document.activeElement);

  const focusAt = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const moveFocus = (step: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const current = focusedIndex();
    const currentInEnabled = enabledIndexes.indexOf(current);
    const next =
      currentInEnabled === -1
        ? step === 1
          ? 0
          : enabledIndexes.length - 1
        : (currentInEnabled + step + enabledIndexes.length) % enabledIndexes.length;
    focusAt(enabledIndexes[next]);
  };

  // 选择动作后关闭菜单；父级受控卸载，onClose 重复调用应为幂等。
  const runAction = (action: GraphContextMenuAction) => {
    if (action.disabled) return;
    action.onSelect();
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        return;
      case 'Home':
        event.preventDefault();
        if (enabledIndexes.length > 0) focusAt(enabledIndexes[0]);
        return;
      case 'End':
        event.preventDefault();
        if (enabledIndexes.length > 0) focusAt(enabledIndexes[enabledIndexes.length - 1]);
        return;
      case 'Enter': {
        // 显式处理 Enter 并阻止原生按钮的默认 click，避免 onSelect 触发两次。
        const index = focusedIndex();
        const action = index >= 0 ? actions[index] : undefined;
        if (action) {
          event.preventDefault();
          runAction(action);
        }
        return;
      }
      default:
        return;
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={titleId}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{ left: position.left, top: position.top, maxHeight }}
      className="fixed z-50 w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-elevated/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-elevated/95 px-3 py-2 backdrop-blur-xl">
        <p id={titleId} title={title} className="truncate text-minor font-medium text-primary">
          {title.trim() || '未命名知识点'}
        </p>
      </div>

      <div className="p-2">
        {actions.length === 0 ? (
          <p className="px-2 py-2 text-tag text-faint" role="none">
            暂无可执行操作
          </p>
        ) : (
          actions.map((action, index) => {
            const disabled = action.disabled === true;
            return (
              <button
                key={action.key}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => runAction(action)}
                className={`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 py-1 text-left text-minor transition-colors duration-150 ${
                  disabled
                    ? 'cursor-not-allowed text-faint'
                    : 'cursor-pointer text-muted hover:bg-surface-hover hover:text-primary focus:bg-surface-hover focus:text-primary'
                }`}
              >
                <span className="w-full truncate">{action.label}</span>
                {action.hint && (
                  <span title={action.hint} className="w-full truncate text-tag text-faint">
                    {action.hint}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
