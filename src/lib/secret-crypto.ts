const PREFIX = 'enc:v1:';

/**
 * 加密主密钥来源：
 * - SETTINGS_ENCRYPTION_KEY：独立主密钥（推荐，改口令不影响已存密文）
 * - AUTH_PASSCODE：未配独立密钥时从登录口令派生（改口令会使旧密文失效）
 * - none：两者都没配
 */
export type SecretKeySource = 'SETTINGS_ENCRYPTION_KEY' | 'AUTH_PASSCODE' | 'none';

/** 当前加密主密钥的来源（只读 env，不产生副作用）。 */
export function settingsKeySource(): SecretKeySource {
  if (process.env.SETTINGS_ENCRYPTION_KEY?.trim()) return 'SETTINGS_ENCRYPTION_KEY';
  if (process.env.AUTH_PASSCODE?.trim()) return 'AUTH_PASSCODE';
  return 'none';
}

function masterSecret(): string | null {
  return process.env.SETTINGS_ENCRYPTION_KEY?.trim() || process.env.AUTH_PASSCODE?.trim() || null;
}

async function encryptionKey(): Promise<CryptoKey | null> {
  const secret = masterSecret();
  if (!secret) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kb-settings-v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await encryptionKey();
  if (!key) throw new Error('缺少 SETTINGS_ENCRYPTION_KEY 或 AUTH_PASSCODE，无法加密设置');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${PREFIX}${Buffer.from(iv).toString('base64url')}:${Buffer.from(encrypted).toString('base64url')}`;
}

/**
 * 解密结果的分类。区分「从未加密过」与「解不开」是必要的：
 * 前者是正常状态，后者最常见的原因是登录口令变更导致派生密钥变化，
 * 两者对用户的处置动作完全不同（前者无需处理，后者必须重新填写 Key）。
 */
export type SecretDecryptOutcome =
  /** 明文载荷（历史未加密行），原样返回 */
  | 'plaintext'
  /** 解密成功 */
  | 'ok'
  /** 未配置任何主密钥 */
  | 'no-key'
  /** 密文损坏或主密钥不匹配 */
  | 'invalid';

export interface SecretDecryptResult {
  outcome: SecretDecryptOutcome;
  value: string | null;
}

/** 带原因分类的解密。 */
export async function decryptSecretDetailed(payload: string): Promise<SecretDecryptResult> {
  if (!payload.startsWith(PREFIX)) return { outcome: 'plaintext', value: payload };
  const key = await encryptionKey();
  if (!key) return { outcome: 'no-key', value: null };
  const [ivPart, cipherPart] = payload.slice(PREFIX.length).split(':');
  if (!ivPart || !cipherPart) return { outcome: 'invalid', value: null };
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(ivPart, 'base64url') },
      key,
      Buffer.from(cipherPart, 'base64url'),
    );
    return { outcome: 'ok', value: new TextDecoder().decode(decrypted) };
  } catch {
    return { outcome: 'invalid', value: null };
  }
}

/**
 * 与引入 outcome 分类之前逐字一致：明文原样返回，其余失败一律 null。
 * 保留此函数是因为它是对外的稳定 API，调用方不需要知道失败的具体原因。
 */
export async function decryptSecret(payload: string): Promise<string | null> {
  return (await decryptSecretDetailed(payload)).value;
}
