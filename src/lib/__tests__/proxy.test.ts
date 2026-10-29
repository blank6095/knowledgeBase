import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import proxy from '@/proxy';
import { sessionToken } from '../auth';

const originalPasscode = process.env.AUTH_PASSCODE;

afterEach(() => {
  if (originalPasscode === undefined) delete process.env.AUTH_PASSCODE;
  else process.env.AUTH_PASSCODE = originalPasscode;
});

describe('认证代理', () => {
  it('口令缺失时 API fail-closed', async () => {
    delete process.env.AUTH_PASSCODE;
    const res = await proxy(new NextRequest('http://localhost/api/stats'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: '服务器未配置 AUTH_PASSCODE' });
  });

  it('口令缺失时页面回到登录页', async () => {
    delete process.env.AUTH_PASSCODE;
    const res = await proxy(new NextRequest('http://localhost/notes'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login');
  });

  it('有效会话放行', async () => {
    process.env.AUTH_PASSCODE = 'test-passcode';
    const token = await sessionToken();
    const req = new NextRequest('http://localhost/api/stats', {
      headers: { cookie: `kb_session=${token}` },
    });
    const res = await proxy(req);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
