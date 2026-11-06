/**
 * 轻量焦点陷阱（UX-16）：移动端「更多」抽屉、AI 预览浮层、全站检索浮层共用的一份实现。
 *
 * 约定：
 * - 打开时把焦点放到弹层内首个可聚焦元素；弹层内没有可聚焦元素时，让容器自身可聚焦再聚焦；
 * - Tab / Shift+Tab 在弹层内循环，焦点不会漏到遮罩背后的页面；
 * - Esc 交给调用方的 `onEscape`（关闭动作由组件决定，本模块不持有弹层状态）；
 * - 关闭（含卸载）时把焦点还原到打开前的触发元素，元素已被卸载则静默跳过。
 *
 * 为什么不用原生 `<dialog>`：本项目弹层是自绘的 fixed 面板 + 遮罩（底部抽屉/AI 预览/
 * 检索浮层），原生 dialog 的 `showModal` 会改变层级与 inert 行为，且与会拖拽的画布事件
 * 冲突。这里只保留纯函数 + 一个 hook，便于在 node 环境的单测里按需覆盖纯函数。
 */
import { useEffect, useRef, type RefObject } from 'react';

/** 可聚焦选择器：与浏览器 Tab 行为对齐，排除负 tabindex 与禁用元素 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 元素自身是否隐藏（祖先隐藏由 getClientRects 兜底，见 getFocusableElements） */
function isHidden(element: HTMLElement): boolean {
  if (element.hidden) return true;
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}

/**
 * 弹层内当前可参与 Tab 的元素（文档顺序）。
 * `root` 为空时返回空数组，调用方无需判空。
 */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !isHidden(element) &&
      element.getClientRects().length > 0,
  );
}

/** 打开时聚焦：首个可聚焦元素；没有则让容器自身可聚焦后再聚焦 */
export function focusFirstIn(container: HTMLElement | null): void {
  if (!container) return;
  const [first] = getFocusableElements(container);
  if (first) {
    first.focus({ preventScroll: true });
    return;
  }
  container.tabIndex = -1;
  container.focus({ preventScroll: true });
}

/**
 * Tab 循环：返回 true 表示已拦截并改写了焦点。
 * 焦点在弹层中间时返回 false，交给浏览器原生顺序，避免破坏多行/分栏的阅读顺序。
 */
export function trapTabKey(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (event.key !== 'Tab' || !root) return false;
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inside = current !== null && root.contains(current);
  if (event.shiftKey) {
    if (!inside || current === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  if (!inside || current === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  return false;
}

/** 关闭后还原焦点：元素已被卸载时静默跳过 */
export function restoreFocus(element: HTMLElement | null): void {
  if (element && element.isConnected) element.focus({ preventScroll: true });
}

export interface FocusTrapOptions {
  /** 弹层是否打开；false 时不做任何事（组件可常驻） */
  active: boolean;
  /** 弹层容器（遮罩不要包进来），需覆盖弹层内全部可聚焦元素 */
  containerRef: RefObject<HTMLElement | null>;
  /** Esc 关闭：由组件决定关闭哪个弹层 */
  onEscape: () => void;
}

/**
 * 焦点陷阱 hook：管住「初始聚焦 + Tab 循环 + Esc + 关闭后还原」四件事。
 * 依赖 `active` 变化触发挂载/还原，因此组件可以常驻挂载、按需开关。
 */
export function useFocusTrap({ active, containerRef, onEscape }: FocusTrapOptions): void {
  const escapeRef = useRef(onEscape);

  // 用 ref 装回调：父组件每次渲染传入新的箭头函数时，不应重装监听、更不应重新聚焦
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const root = containerRef.current;
    const focusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 焦点已在弹层内部（重复打开）时不覆盖原来的触发元素
    const restoreTo = focusedBeforeOpen && (!root || !root.contains(focusedBeforeOpen)) ? focusedBeforeOpen : null;

    focusFirstIn(root);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        escapeRef.current();
        return;
      }
      trapTabKey(event, root);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus(restoreTo);
    };
  }, [active, containerRef]);
}
