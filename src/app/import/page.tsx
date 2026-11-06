'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import InlineFeedback from '@/components/InlineFeedback';

interface ImportResult {
  documentId: string;
  segmentCount: number;
  linkCount: number;
  aiSplitApplied: number;
  aiSplitFailed: number;
}

const GRANULARITY = [
  { label: '粗', value: 2400 },
  { label: '标准', value: 1800 },
  { label: '细', value: 1200 },
] as const;

/**
 * 单文件上限（UX-22）：`accept` 只是提示，真正拦截靠 onChange 里的校验。
 * 取 4MB 而非更大值：部署平台（Vercel Hobby）请求体上限约 4.5MB（README 已知限制），
 * 超过会在请求到达路由前就被平台拒绝，前端提前拦下表意更清楚。
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_LABEL = '4 MB';
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
const ACCEPTED_EXTENSIONS_LABEL = '.md / .markdown / .txt';

/** 扩展名与 MIME 双校验：扩展名必须在白名单内；MIME 允许浏览器/系统给的空值与 octet-stream */
function checkTextFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `文件类型不支持：仅支持 ${ACCEPTED_EXTENSIONS_LABEL}，请重新选择`;
  }
  const mime = file.type.toLowerCase();
  if (mime && mime !== 'application/octet-stream' && !mime.startsWith('text/')) {
    return `文件类型不支持（${file.type}）：仅支持纯文本 ${ACCEPTED_EXTENSIONS_LABEL}`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单个文件上限 ${MAX_FILE_LABEL}，请拆分后再导入`;
  }
  if (file.size === 0) return '文件是空的，请选择有内容的文件或直接粘贴 Markdown';
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-tag uppercase text-faint">{children}</p>;
}

export default function ImportPage() {

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [maxChars, setMaxChars] = useState(1800);
  const [aiSplit, setAiSplit] = useState(false);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // LLM 配置探测：未配置时「语义拆分」开关禁用并提示去设置页
  useEffect(() => {
    let cancelled = false;
    api<{ configured: boolean }>('/api/ai/config')
      .then((c) => {
        if (!cancelled) setLlmReady(c.configured);
      })
      .catch(() => {
        if (!cancelled) setLlmReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || loading) return;
    setError('');
    setResult(null);

    // UX-22：`accept` 拦不住拖拽/改后缀，选中后必须自己校验类型与大小
    const invalid = checkTextFile(file);
    if (invalid) {
      input.value = '';
      setError(invalid);
      return;
    }

    try {
      const text = await file.text();
      setFilename(file.name);
      setContent(text);
      if (!title) setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
    } catch {
      // 不可读文件（权限/编码异常）此前会让 unhandled rejection 静默吞掉，用户看不到任何反馈
      input.value = '';
      setError('文件读取失败：可能是权限或编码问题，请另存为 UTF-8 的 Markdown 后重试，或直接粘贴内容');
    }
  };

  const submit = async () => {
    setError('');
    setResult(null);
    if (!content.trim()) {
      setError('请粘贴 Markdown 内容或选择 .md 文件');
      return;
    }
    setLoading(true);
    try {
      const res = await api<ImportResult>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          filename: filename || undefined,
          source: filename ? 'file' : 'paste',
          maxChars,
          aiSplit: aiSplit || undefined,
        }),
      });
      setResult(res);
      setContent('');
      setFilename('');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-form space-y-5">
      <div className="fade-up">
        <h1 className="font-display text-title font-semibold">导入知识</h1>
        <p className="mt-1.5 text-body text-muted">
          支持 Markdown 文件或直接粘贴。导入后按标题层级自动拆解为知识点、提取标签与 [[双链]] 关联，原文备份到 Cloudflare R2。
        </p>
      </div>

      <div className="card fade-up space-y-6 p-5" style={{ animationDelay: '80ms' }}>
        {/* 来源 */}
        <section>
          <SectionLabel>来源</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-minor text-muted">标题（留空自动取文件名/首个标题）</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-line bg-app px-3 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="如：React Hooks 笔记"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-minor text-muted">选择 .md 文件</span>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt"
                onChange={onFile}
                disabled={loading}
                className="w-full text-minor text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-body file:font-medium file:text-accent-ink transition-colors hover:file:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="mt-1 block text-tag text-faint">
                支持 {ACCEPTED_EXTENSIONS_LABEL}，单个文件不超过 {MAX_FILE_LABEL}（受部署平台请求体上限约束）
              </span>
            </label>
          </div>
        </section>

        {/* 粒度 */}
        <section className="border-t border-line pt-4">
          <SectionLabel>粒度</SectionLabel>
          <div className="flex overflow-hidden rounded-lg border border-line sm:w-72">
            {GRANULARITY.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setMaxChars(g.value)}
                disabled={loading}
                className={`flex min-h-11 flex-1 items-center justify-center px-4 py-2 text-body transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                  maxChars === g.value
                    ? 'bg-accent font-medium text-accent-ink'
                    : 'bg-app text-muted hover:bg-surface-hover hover:text-primary'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-tag text-faint">
            ## 章节为一个阅读单元（### 并入父节，超长才拆）。按标题层级优先拆解，超长内容降级到句子边界，代码块与表格始终保持完整。粗 ≈ 2400 字 · 标准 ≈ 1800 字 · 细 ≈ 1200 字
          </p>
          <label
            title={llmReady ? undefined : '未配置大模型：到「设置」页填写 DeepSeek API Key 后可用'}
            className={`mt-3 flex items-start gap-2 ${llmReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
          >
            <input
              type="checkbox"
              checked={aiSplit}
              disabled={!llmReady || loading}
              onChange={(e) => setAiSplit(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="text-minor text-muted">
              语义拆分（消耗 token）
              <span className="block text-tag text-faint">
                仅处理超长段落（每篇至多 5 段），由大模型按语义重组为更小的知识点；失败自动保留结构拆分结果，不阻断导入。
                {llmReady === false && <span className="ml-1 text-warn">未配置大模型，到「设置」页启用。</span>}
              </span>
            </span>
          </label>
        </section>

        {/* 内容 */}
        <section className="border-t border-line pt-4">
          <SectionLabel>内容</SectionLabel>
          <label className="block">
            <span className="mb-1 block text-minor text-muted">粘贴 Markdown</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={loading}
              rows={12}
              placeholder={'---\ntitle: 笔记标题\ntags: [前端, React]\n---\n\n## 第一节\n内容…\n\n## 第二节\n内容…'}
              className="w-full rounded-lg border border-line bg-app p-3 font-mono text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </section>

        {error && <InlineFeedback tone="danger">{error}</InlineFeedback>}

        {result && (
          <div className="space-y-1.5 rounded-lg border border-success/25 bg-success/10 p-4">
            <p className="fade-up text-body font-medium text-success" style={{ animationDelay: '0ms' }}>
              已收入手稿。
            </p>
            <p className="fade-up text-minor text-muted" style={{ animationDelay: '40ms' }}>
              拆成 <span className="font-mono tabular-nums text-primary">{result.segmentCount}</span> 个知识点，建立{' '}
              <span className="font-mono tabular-nums text-primary">{result.linkCount}</span> 条关联，等着被逐一点亮。
            </p>
            {(result.aiSplitApplied > 0 || result.aiSplitFailed > 0) && (
              <p className="fade-up text-minor text-muted" style={{ animationDelay: '60ms' }}>
                语义拆分：<span className="font-mono tabular-nums text-primary">{result.aiSplitApplied}</span> 段成功
                {result.aiSplitFailed > 0 && (
                  <>
                    ，<span className="font-mono tabular-nums text-warn">{result.aiSplitFailed}</span> 段失败（已保留结构拆分结果）
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={`/notes/${result.documentId}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3.5 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
              >
                查看文档
              </Link>
              <Link
                href="/graph"
                className="inline-flex min-h-11 items-center rounded-lg border border-line px-3.5 text-body text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
              >
                查看关系图谱
              </Link>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-tag text-muted transition-colors duration-150 hover:text-primary"
              >
                继续导入
              </button>
            </div>
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className={`inline-flex min-h-11 items-center rounded-lg px-5 text-body font-medium transition-colors duration-150 disabled:opacity-50 ${
            result
              ? 'border border-line text-muted hover:bg-surface-hover hover:text-primary'
              : 'bg-accent text-accent-ink hover:bg-accent-strong'
          }`}
        >
          {loading ? '导入中…' : result ? '再导入一篇' : '导入'}
        </button>
      </div>
    </div>
  );
}
