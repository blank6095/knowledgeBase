import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** R2 是否已配置（未配置时导入仍可用，只是不保存原始文件） */
export function r2Configured(): boolean {
  const e = process.env;
  return !!(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET);
}

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/** 保存导入的原始 Markdown 到 R2，返回对象键；未配置或失败返回 null（不影响导入主流程） */
export async function putOriginal(content: string, filename: string): Promise<string | null> {
  if (!r2Configured()) return null;
  const key = `originals/${Date.now()}-${filename.replace(/[^\w.\u4e00-\u9fa5-]/g, '_')}`;
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
        Body: content,
        ContentType: 'text/markdown; charset=utf-8',
      }),
    );
    return key;
  } catch (err) {
    console.error('R2 上传失败（已跳过）:', err);
    return null;
  }
}
