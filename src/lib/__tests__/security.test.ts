import { afterEach, describe, expect, it } from 'vitest';
import { isUnauthenticated, passcodeConfigured, passcodeMatches, sessionToken } from '../auth';
import { escapeHtml, safeNextPath } from '../security';

const originalPasscode = process.env.AUTH_PASSCODE;

afterEach(() => {
  if (originalPasscode === undefined) delete process.env.AUTH_PASSCODE;
  else process.env.AUTH_PASSCODE = originalPasscode;
});

describe('escapeHtml', () => {
  it('将图谱 tooltip 中可执行标签转成纯文本', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
  });

  it('处理空值并转义单引号与 &', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml("A&B's")).toBe('A&amp;B&#39;s');
  });
});

describe('safeNextPath', () => {
  it.each(['/notes', '/graph?fixture=graph-mid#node-1', '/segments/abc?tab=read'])(
    '保留站内路径 %s',
    (value) => expect(safeNextPath(value)).toBe(value),
  );

  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    '拒绝站外跳转 %s',
    (value) => expect(safeNextPath(value)).toBe('/graph'),
  );
});

describe('口令鉴权', () => {
  it('未配置口令时 fail-closed，固定空口令令牌也不能通过', async () => {
    delete process.env.AUTH_PASSCODE;
    expect(passcodeConfigured()).toBe(false);
    expect(await sessionToken()).toBeNull();
    expect(
      await isUnauthenticated({ headers: new Headers({ cookie: `kb_session=${'0'.repeat(64)}` }) } as Request),
    ).toBe(true);
  });

  it('空白口令视为未配置', () => {
    process.env.AUTH_PASSCODE = '   ';
    expect(passcodeConfigured()).toBe(false);
  });

  it('配置口令后生成稳定令牌', async () => {
    process.env.AUTH_PASSCODE = 'test-passcode';
    const token = await sessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await isUnauthenticated({ headers: new Headers({ cookie: `kb_session=${token}` }) } as Request),
    ).toBe(false);
  });

  it('恒定时间比较接受正确口令并拒绝错误口令', async () => {
    process.env.AUTH_PASSCODE = 'test-passcode';
    await expect(passcodeMatches('test-passcode')).resolves.toBe(true);
    await expect(passcodeMatches('wrong-passcode')).resolves.toBe(false);
  });
});
