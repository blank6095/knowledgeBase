import { NextRequest, NextResponse } from 'next/server';
import { passcodeConfigured, readSessionCookie, sessionToken } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth'];

/** 全站登录门：未携带有效会话 Cookie 时，页面跳转 /login，API 返回 401 */
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (!passcodeConfigured()) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: '服务器未配置 AUTH_PASSCODE' }, { status: 503 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const expected = await sessionToken();
  const token = readSessionCookie(req.headers.get('cookie'));
  if (expected && token === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
};
