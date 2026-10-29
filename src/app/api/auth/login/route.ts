import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, passcodeConfigured, passcodeMatches, sessionToken } from '@/lib/auth';
import { clearLoginFailures, clientLoginKey, loginRateLimit, recordLoginFailure } from '@/lib/login-rate-limit';


export async function POST(req: NextRequest) {
  if (!passcodeConfigured()) {
    return NextResponse.json({ error: '服务器未配置 AUTH_PASSCODE，请先在环境变量中设置访问口令' }, { status: 500 });
  }
  const loginKey = clientLoginKey(req);
  const limit = loginRateLimit(loginKey);
  if (limit.blocked) {
    return NextResponse.json(
      { error: `尝试次数过多，请 ${Math.ceil(limit.retryAfterSec / 60)} 分钟后再试` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: unknown };
  if (typeof passcode !== 'string' || !(await passcodeMatches(passcode))) {
    recordLoginFailure(loginKey);
    return NextResponse.json({ error: '口令错误' }, { status: 401 });
  }
  clearLoginFailures(loginKey);

  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: '服务器未配置 AUTH_PASSCODE' }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  return res;
}
