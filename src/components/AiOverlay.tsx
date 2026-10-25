'use client';

import { useEffect } from 'react';

/**
 * AI 预览浮层壳：遮罩 + elevated 面板（底部居中，最宽 42rem 对齐阅读栏），
 * Esc / 点遮罩关闭；fade-up 动画在 reduced-motion 下直显（globals 约定）。
 */
export default function AiOverlay({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="fade-up absolute bottom-6 left-1/2 flex max-h-[80vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <p className="font-display text-body font-semibold text-primary">{title}</p>
            {subtitle && <p className="mt-0.5 text-tag text-faint">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭预览"
            className="shrink-0 rounded-md px-2 py-1 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}
