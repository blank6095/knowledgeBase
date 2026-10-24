export const SESSION_COOKIE = 'kb_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

/**
 * 会话令牌 = SHA-256(口令)。个人自用场景下以最小实现做全站登录门，
 * 令牌不落库、不加盐，泄露面等价于口令本身。
 */
export async function sessionToken(): Promise<string> {
  const pass = process.env.AUTH_PASSCODE ?? '';
  const data = new TextEncoder().encode(`kb-v1:${pass}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)kb_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** API 路由用：未登录返回 true */
export async function isUnauthenticated(req: Request): Promise<boolean> {
  const token = readSessionCookie(req.headers.get('cookie'));
  return token === null || token !== (await sessionToken());
}

export function passcodeConfigured(): boolean {
  return !!process.env.AUTH_PASSCODE;
}
