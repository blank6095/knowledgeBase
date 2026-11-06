import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LLM Key 密文「可解密状态」的回归守卫。
 *
 * 背景：主密钥默认从 AUTH_PASSCODE 派生（SETTINGS_ENCRYPTION_KEY 可选），
 * 用户改了登录口令后，已存密文会静默解不开——getLlmSettings() 一律返回 null，
 * 外部只能看到「未配置」，真实原因（Key 还在、只是解不开）被吞掉。
 * 排查这个问题必须翻文档 + 重新填一次 Key，属于可避免的静默数据可用性损失。
 *
 * 本文件锁住两件事：
 * 1. decryptSecret 的对外语义**逐字不变**（明文原样返回、失败一律 null）——
 *    引入 outcome 分类是纯增量，不得改变既有调用方的结果；
 * 2. decryptSecretDetailed 能把「解不开」与「从未加密过」区分开。
 */

const state = { rows: [] as unknown[] };

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => state.rows,
      }),
    }),
  },
}));

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;
const originalPass = process.env.AUTH_PASSCODE;

beforeEach(() => {
  state.rows = [];
  process.env.SETTINGS_ENCRYPTION_KEY = 'test-master-key';
  process.env.AUTH_PASSCODE = 'test-passcode';
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  if (originalPass === undefined) delete process.env.AUTH_PASSCODE;
  else process.env.AUTH_PASSCODE = originalPass;
  vi.resetModules();
});

describe('secret-crypto：解密结果分类', () => {
  it('decryptSecret 语义不变：明文原样返回', async () => {
    const { decryptSecret } = await import('../secret-crypto');
    expect(await decryptSecret('plain-value')).toBe('plain-value');
    expect(await decryptSecret('')).toBe('');
  });

  it('decryptSecret 语义不变：解不开一律 null', async () => {
    const { decryptSecret, encryptSecret } = await import('../secret-crypto');
    const encrypted = await encryptSecret('secret');
    process.env.SETTINGS_ENCRYPTION_KEY = 'another-key';
    expect(await decryptSecret(encrypted)).toBeNull();
    expect(await decryptSecret(`${encrypted}x`)).toBeNull();
    expect(await decryptSecret('enc:v1:garbage')).toBeNull();
  });

  it('decryptSecretDetailed 区分 plaintext / ok / invalid', async () => {
    const { decryptSecretDetailed, encryptSecret } = await import('../secret-crypto');
    expect(await decryptSecretDetailed('plain-value')).toEqual({ outcome: 'plaintext', value: 'plain-value' });

    const encrypted = await encryptSecret('secret');
    expect(await decryptSecretDetailed(encrypted)).toEqual({ outcome: 'ok', value: 'secret' });

    process.env.SETTINGS_ENCRYPTION_KEY = 'another-key';
    expect(await decryptSecretDetailed(encrypted)).toEqual({ outcome: 'invalid', value: null });
  });

  it('未配置任何主密钥时 outcome 为 no-key', async () => {
    const { decryptSecretDetailed } = await import('../secret-crypto');
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.AUTH_PASSCODE;
    expect(await decryptSecretDetailed('enc:v1:abc:def')).toEqual({ outcome: 'no-key', value: null });
  });

  it('settingsKeySource 如实反映密钥来源', async () => {
    const { settingsKeySource } = await import('../secret-crypto');
    expect(settingsKeySource()).toBe('SETTINGS_ENCRYPTION_KEY');

    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(settingsKeySource()).toBe('AUTH_PASSCODE');

    delete process.env.AUTH_PASSCODE;
    expect(settingsKeySource()).toBe('none');
  });
});

describe('app-settings：getLlmKeyState', () => {
  it('无记录时为 unset', async () => {
    const { getLlmKeyState } = await import('../app-settings');
    state.rows = [];
    expect(await getLlmKeyState()).toBe('unset');
  });

  it('旧明文行视为 ok', async () => {
    const { getLlmKeyState } = await import('../app-settings');
    state.rows = [{ value: { apiKey: 'sk-legacy', model: 'deepseek-chat' } }];
    expect(await getLlmKeyState()).toBe('ok');
  });

  it('密文可解密时为 ok', async () => {
    const { getLlmKeyState } = await import('../app-settings');
    const { encryptSecret } = await import('../secret-crypto');
    state.rows = [{ value: { apiKeyEnc: await encryptSecret('sk-1'), model: 'deepseek-chat' } }];
    expect(await getLlmKeyState()).toBe('ok');
  });

  it('改了登录口令导致密文解不开时为 key-mismatch', async () => {
    const { getLlmKeyState } = await import('../app-settings');
    const { encryptSecret } = await import('../secret-crypto');
    // 未配独立密钥 → 密文绑定当前口令
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.AUTH_PASSCODE = 'old-passcode';
    const apiKeyEnc = await encryptSecret('sk-1');

    // 模拟用户改了登录口令
    process.env.AUTH_PASSCODE = 'new-passcode';
    state.rows = [{ value: { apiKeyEnc, model: 'deepseek-chat' } }];
    expect(await getLlmKeyState()).toBe('key-mismatch');
  });

  it('探测异常不抛出，按 unset 处理（诊断字段不得影响主流程）', async () => {
    const { getLlmKeyState } = await import('../app-settings');
    // 让 select 链抛错
    const { db } = await import('@/db');
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('db down');
    });
    expect(await getLlmKeyState()).toBe('unset');
  });
});
