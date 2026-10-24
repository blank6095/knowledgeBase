import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, passcodeConfigured, sessionToken } from '@/lib/auth';


export async function POST(req: NextRequest) {
  if (!passcodeConfigured()) {
    return NextResponse.json({ error: '服务器未配置 AUTH_PASSCODE，请先在环境变量中设置访问口令' }, { status: 500 });
  }
  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (!passcode || passcode !== process.env.AUTH_PASSCODE) {
    return NextResponse.json({ error: '口令错误' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  return res;
}
