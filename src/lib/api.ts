import { NextResponse } from 'next/server';
import { isUnauthenticated } from './auth';

/** API 路由统一登录校验：未登录时返回 401 响应，否则返回 null 放行 */
export async function guard(req: Request): Promise<NextResponse | null> {
  return (await isUnauthenticated(req))
    ? NextResponse.json({ error: '未登录' }, { status: 401 })
    : null;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = '资源不存在') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
