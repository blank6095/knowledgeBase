const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** 登录后只允许回到当前站点内的绝对路径；无合法目标时默认进图谱（UQ1/UQ3 拍板）。 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/graph';

  try {
    const origin = 'https://knowledge-base.invalid';
    const target = new URL(value, origin);
    if (target.origin !== origin) return '/graph';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/graph';
  }
}
