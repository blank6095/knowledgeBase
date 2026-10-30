import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../secret-crypto';

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;
const originalPass = process.env.AUTH_PASSCODE;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  if (originalPass === undefined) delete process.env.AUTH_PASSCODE;
  else process.env.AUTH_PASSCODE = originalPass;
});

describe('secret-crypto', () => {
  it('AES-GCM 加密后可解密且不包含明文', async () => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'test-master-key';
    const value = 'sk-sensitive-value';
    const encrypted = await encryptSecret(value);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(value);
    expect(await decryptSecret(encrypted)).toBe(value);
  });

  it('篡改密文或更换主密钥后解密失败', async () => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'key-a';
    const encrypted = await encryptSecret('secret');
    process.env.SETTINGS_ENCRYPTION_KEY = 'key-b';
    expect(await decryptSecret(encrypted)).toBeNull();
    expect(await decryptSecret(`${encrypted}x`)).toBeNull();
  });

  it('未配置专用密钥时从 AUTH_PASSCODE 派生', async () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.AUTH_PASSCODE = 'existing-passcode';
    const encrypted = await encryptSecret('secret');
    expect(await decryptSecret(encrypted)).toBe('secret');
  });
});
