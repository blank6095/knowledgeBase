const PREFIX = 'enc:v1:';

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

export async function decryptSecret(payload: string): Promise<string | null> {
  if (!payload.startsWith(PREFIX)) return payload;
  const key = await encryptionKey();
  if (!key) return null;
  const [ivPart, cipherPart] = payload.slice(PREFIX.length).split(':');
  if (!ivPart || !cipherPart) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(ivPart, 'base64url') },
      key,
      Buffer.from(cipherPart, 'base64url'),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
