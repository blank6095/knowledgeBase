'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import InlineFeedback from '@/components/InlineFeedback';

interface AiConfig {
  configured: boolean;
  model: string | null;
  fastModel?: string | null;
  keyTail: string | null;
  learnerDeclaration?: string;
}

interface UsageDay {
  day: string;
  calls: number;
  cachedHits: number;
  inTok: number;
  outTok: number;
  errors: number;
  avgMs: number;
}

interface Usage {
  days: UsageDay[];
  today: { calls: number; tokens: number; guardrail: number };
  previewHitRate: number | null;
}

const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

/** 应用内设置：LLM API Key（仅存服务端 DB，页面只显示尾 4 位）与模型选择，附连接测试 */
export default function SettingsPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelChoice, setModelChoice] = useState<string>(MODEL_OPTIONS[0]);
  const [customModel, setCustomModel] = useState('');
  const [fastChoice, setFastChoice] = useState<string>('');
  const [customFast, setCustomFast] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testErr, setTestErr] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [declaration, setDeclaration] = useState('');

  const reload = async () => {
    const c = await api<AiConfig & { learnerDeclaration?: string }>('/api/ai/config');
    applyConfig(c);
  };

  const applyConfig = (c: AiConfig & { learnerDeclaration?: string }) => {
    setConfig(c);
    if (typeof c.learnerDeclaration === 'string') setDeclaration(c.learnerDeclaration);
    if (c.model) {
      if (MODEL_OPTIONS.includes(c.model)) setModelChoice(c.model);
      else {
        setModelChoice('custom');
        setCustomModel(c.model);
      }
    }
    const fast = typeof c.fastModel === 'string' && c.fastModel ? c.fastModel : '';
    if (!fast) setFastChoice('');
    else if (MODEL_OPTIONS.includes(fast)) setFastChoice(fast);
    else {
      setFastChoice('custom');
      setCustomFast(fast);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api<AiConfig & { learnerDeclaration?: string }>('/api/ai/config')
      .then((c) => {
        if (!cancelled) applyConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig({ configured: false, model: null, keyTail: null });
      });
    api<Usage>('/api/ai/usage')
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch((e: Error) => {
        // 用量读取失败此前被静默吞掉，用户会误以为「没有调用记录」
        if (!cancelled) setUsageError(e.message || '用量读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveErr('');
    setTestMsg('');
    setTestErr('');
    try {
      const model = modelChoice === 'custom' ? customModel.trim() : modelChoice;
      const fastModel = fastChoice === 'custom' ? customFast.trim() : fastChoice;
      const r = await api<{ model: string; fastModel?: string; keyTail: string | null }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey.trim(), model, fastModel, learnerDeclaration: declaration }),
      });
      setApiKey('');
      setSaveMsg(`已保存（模型 ${r.model}${r.fastModel ? ` · fast 档 ${r.fastModel}` : ''}${r.keyTail ? ` · Key 尾号 ****${r.keyTail}` : ''}）`);
      await reload();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestMsg('');
    setTestErr('');
    try {
      const r = await api<{ ok: boolean; reply?: string; error?: string }>('/api/ai/test', { method: 'POST' });
      if (r.ok) setTestMsg(`连接成功（${r.reply ?? ''}）`);
      else setTestErr(r.error ?? '连接失败');
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : '连接失败');
    } finally {
      setTesting(false);
    }
  };


  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="fade-up">
        <h1 className="font-display text-title font-semibold">设置</h1>
        <p className="mt-1.5 text-minor text-muted">
          大模型接入用于编辑态的语义拆解/聚合与「问知识库」。API Key 只保存在服务端数据库，页面与接口均不回显明文。
        </p>
      </div>

      <section className="card fade-up space-y-4 px-5 py-4" style={{ animationDelay: '80ms' }}>
        <div>
          <p className="text-tag uppercase text-faint">DeepSeek API Key</p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config?.keyTail ? `已保存（尾号 ****${config.keyTail}），留空表示不修改` : '粘贴 DeepSeek API Key（sk-…）'
            }
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-lg border border-line bg-app px-3 py-2 font-mono text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
          />
        </div>

        <div>
          <p className="text-tag uppercase text-faint">模型</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className="min-w-48 rounded-lg border border-line bg-app px-3 py-2 text-minor text-primary outline-none transition-colors focus:border-accent"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === MODEL_OPTIONS[0] ? '（默认）' : ''}
                </option>
              ))}
              <option value="custom">自定义…</option>
            </select>
            {modelChoice === 'custom' && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="输入模型 id"
                className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-2 font-mono text-minor text-primary outline-none transition-colors focus:border-accent"
              />
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-tag text-faint">fast 档（摘要/测试连接）</span>
            <select
              value={fastChoice}
              onChange={(e) => setFastChoice(e.target.value)}
              className="min-w-48 rounded-lg border border-line bg-app px-3 py-1.5 text-tag text-primary outline-none transition-colors focus:border-accent"
            >
              <option value="">同主模型</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="custom">自定义…</option>
            </select>
            {fastChoice === 'custom' && (
              <input
                value={customFast}
                onChange={(e) => setCustomFast(e.target.value)}
                placeholder="fast 档模型 id"
                className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 font-mono text-tag text-primary outline-none transition-colors focus:border-accent"
              />
            )}
          </div>
        </div>

        <div>
          <p className="text-tag uppercase text-faint">学习者自述（可选，供 AI 个性化）</p>
          <textarea
            value={declaration}
            onChange={(e) => setDeclaration(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="如：后端方向求职，正在补计算机网络与 Node.js；喜欢先看结论再看细节。会随「问知识库」与 AI 拆解/聚合注入，使回答与拆解粒度贴合你的目标。"
            className="mt-1.5 w-full resize-y rounded-lg border border-line bg-app px-3 py-2 text-minor leading-relaxed text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={testConnection}
            disabled={testing}
            title="服务端发一次最小请求验证 Key 与网络"
            className="rounded-lg border border-line px-4 py-1.5 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          {saveMsg && <span className="text-tag text-success">{saveMsg}</span>}
          {saveErr && <span className="text-tag text-danger">{saveErr}</span>}
          {testMsg && <span className="text-tag text-success">{testMsg}</span>}
          {testErr && <span className="text-tag text-danger">{testErr}</span>}
        </div>

        <p className="border-t border-line pt-3 text-tag leading-relaxed text-faint">
          配置即存即用，无需重启。DeepSeek 接口地址 https://api.deepseek.com（OpenAI 兼容），在
          api-docs.deepseek.com 申请 API Key。
          {config && !config.configured && ' 当前未配置——「问知识库」与编辑态的 AI 拆解/聚合暂不可用。'}
        </p>
      </section>

      <section className="card fade-up px-5 py-4" style={{ animationDelay: '120ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-tag uppercase text-faint">大模型用量 · 近 7 天</p>
          {usage?.previewHitRate != null && (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-tag text-muted">预览缓存命中 {usage.previewHitRate}%</span>
          )}
        </div>
        {usage && usage.today.calls > 0 && (
          <p className="mt-2 text-tag text-muted">
            今日 {usage.today.calls} 次调用 · {usage.today.tokens.toLocaleString()} token
            {usage.today.tokens > usage.today.guardrail ? (
              <span className="text-danger">（已超 {usage.today.guardrail.toLocaleString()} 护栏）</span>
            ) : (
              <span className="text-faint"> / 护栏 {usage.today.guardrail.toLocaleString()}</span>
            )}
          </p>
        )}
        {usageError ? (
          <div className="mt-3">
            <InlineFeedback tone="danger">用量读取失败：{usageError}</InlineFeedback>
            <button
              type="button"
              onClick={() => {
                setUsageError('');
                setUsage(null);
                api<Usage>('/api/ai/usage')
                  .then(setUsage)
                  .catch((e: Error) => setUsageError(e.message || '用量读取失败'));
              }}
              className="mt-2 rounded-lg border border-line px-3 py-1.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              重试
            </button>
          </div>
        ) : !usage ? (
          <p className="mt-3 text-tag text-muted">正在读取用量…</p>
        ) : usage.days.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-tag">
              <thead>
                <tr className="text-faint">
                  <th className="py-1 pr-3 font-normal">日期</th>
                  <th className="py-1 pr-3 font-normal">调用</th>
                  <th className="py-1 pr-3 font-normal">缓存命中</th>
                  <th className="py-1 pr-3 font-normal">输入 tok</th>
                  <th className="py-1 pr-3 font-normal">输出 tok</th>
                  <th className="py-1 pr-3 font-normal">均耗时</th>
                  <th className="py-1 font-normal">失败</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {usage.days.map((d) => (
                  <tr key={d.day} className="text-muted">
                    <td className="py-1.5 pr-3 tabular-nums">{d.day.slice(5)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.calls}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.cachedHits}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.inTok.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.outTok.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{d.avgMs}ms</td>
                    <td className="py-1.5 tabular-nums">{d.errors > 0 ? <span className="text-danger">{d.errors}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-tag text-muted">还没有调用记录——配置后使用「助手」或 AI 拆解/聚合，这里会逐日累计。</p>
        )}
      </section>

      <Link href="/" className="fade-up inline-block text-tag text-faint transition-colors hover:text-accent hover:underline" style={{ animationDelay: '160ms' }}>
        ← 返回概览
      </Link>
    </div>
  );
}
