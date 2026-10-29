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

/** 登录后只允许回到当前站点内的绝对路径。 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';

  try {
    const origin = 'https://knowledge-base.invalid';
    const target = new URL(value, origin);
    if (target.origin !== origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
