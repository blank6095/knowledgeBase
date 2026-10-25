import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { chatCompletion, getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';

/** 同段并发请求去重：进行中的摘要 Promise 复用，避免重复模型调用与写覆盖 */
const inflight = new Map<string, Promise<string>>();

async function generateSummary(seg: { id: string; title: string; content: string }): Promise<string> {
  const existing = inflight.get(seg.id);
  if (existing) return existing;
  const p = (async () => {
    const output = await chatCompletion([
      {
        role: 'system',
        content: '用一句不超过 30 字的中文概括该知识点。只输出摘要正文，不要解释、不要引号、不要任何前后缀。',
      },
      { role: 'user', content: `标题：${seg.title}\n\n内容：\n${seg.content}` },
    ]);
    const summary = output
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .slice(0, 60); // 30 字约束靠 prompt，硬截 60 容错
    await db.update(segments).set({ summary }).where(eq(segments.id, seg.id));
    return summary;
  })();
  inflight.set(seg.id, p);
  try {
    return await p;
  } finally {
    inflight.delete(seg.id);
  }
}

/** 30 字摘要闪念卡：有缓存直接返回；无值调 LLM 生成并落库（cached:false）；失败返回可读错误 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [seg] = await db
    .select({ id: segments.id, title: segments.title, content: segments.content, summary: segments.summary })
    .from(segments)
    .where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  if (seg.summary) return NextResponse.json({ summary: seg.summary, cached: true });

  if (!(await getLlmConfig())) {
    return NextResponse.json({ error: LLM_SETUP_HINT }, { status: 503 });
  }

  try {
    const summary = await generateSummary(seg);
    return NextResponse.json({ summary, cached: false });
  } catch (e) {
    return NextResponse.json({ error: `摘要生成失败：${e instanceof Error ? e.message : '未知错误'}` }, { status: 502 });
  }
}
