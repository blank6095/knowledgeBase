/**
 * 统一行内反馈：成功 / 警告 / 错误 / 提示。
 *
 * 之前各页面的保存结果、导入结果、AI 状态都是裸文本或裸红字：
 * - 错误没有 role="alert"，屏幕阅读器不会播报；
 * - 成功提示没有 aria-live，动态插入时用户感知不到。
 *
 * 该组件只负责语义与配色，不负责业务状态；调用方传入 tone 与文案即可。
 */
import type { ReactNode } from 'react';

export type FeedbackTone = 'success' | 'warn' | 'danger' | 'info';

const TONE_CLASS: Record<FeedbackTone, string> = {
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-muted',
};

export default function InlineFeedback({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: FeedbackTone;
  children: ReactNode;
  className?: string;
}) {
  // 错误需要立即播报；其余为礼貌播报，避免打断当前朗读
  const a11y = tone === 'danger' ? { role: 'alert' as const } : { 'aria-live': 'polite' as const };
  return (
    <p className={`text-tag leading-relaxed ${TONE_CLASS[tone]} ${className}`.trim()} {...a11y}>
      {children}
    </p>
  );
}
