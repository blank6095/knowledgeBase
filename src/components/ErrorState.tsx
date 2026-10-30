/**
 * 页面级错误态：给出原因 + 可选重试 + 安全去向。
 *
 * 此前多个页面的错误处理都是一行红字，用户既不知道为什么失败，也没有下一步。
 * 该组件不改变数据流，只统一「失败长什么样」。
 */
import Link from 'next/link';

export default function ErrorState({
  message,
  onRetry,
  retryLabel = '重试',
  hint,
  action,
  className = '',
}: {
  message: string;
  /** 提供后展示重试按钮 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 次要说明：如何自行解决 */
  hint?: string;
  /** 自定义去向（默认给出「回到知识库」） */
  action?: { href: string; label: string };
  className?: string;
}) {
  const fallbackAction = { href: '/notes', label: '回到知识库' };
  const link = action ?? fallbackAction;
  return (
    <div className={`card px-5 py-5 ${className}`.trim()} role="alert">
      <p className="font-display text-card text-primary">出了点问题</p>
      <p className="mt-1.5 text-minor leading-relaxed text-danger">{message}</p>
      {hint && <p className="mt-1 text-tag leading-relaxed text-muted">{hint}</p>}
      <div className="mt-4 flex items-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
          >
            {retryLabel}
          </button>
        )}
        <Link href={link.href} className="text-tag text-accent transition-colors duration-150 hover:text-accent-strong hover:underline">
          {link.label} →
        </Link>
      </div>
    </div>
  );
}
