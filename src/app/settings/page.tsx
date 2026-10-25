'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

interface AiConfig {
  configured: boolean;
  model: string | null;
  keyTail: string | null;
}

const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

/** 应用内设置：LLM API Key（仅存服务端 DB，页面只显示尾 4 位）与模型选择，附连接测试 */
export default function SettingsPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelChoice, setModelChoice] = useState<string>(MODEL_OPTIONS[0]);
  const [customModel, setCustomModel] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testErr, setTestErr] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const c = await api<AiConfig>('/api/ai/config');
    applyConfig(c);
  };

  const applyConfig = (c: AiConfig) => {
    setConfig(c);
    if (c.model) {
      if (MODEL_OPTIONS.includes(c.model)) setModelChoice(c.model);
      else {
        setModelChoice('custom');
        setCustomModel(c.model);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    api<AiConfig>('/api/ai/config')
      .then((c) => {
        if (!cancelled) applyConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig({ configured: false, model: null, keyTail: null });
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
      const r = await api<{ model: string; keyTail: string | null }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey.trim(), model }),
      });
      setApiKey('');
      setSaveMsg(`已保存（模型 ${r.model}${r.keyTail ? ` · Key 尾号 ****${r.keyTail}` : ''}）`);
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

      <Link href="/" className="fade-up inline-block text-tag text-faint transition-colors hover:text-accent hover:underline" style={{ animationDelay: '160ms' }}>
        ← 返回概览
      </Link>
    </div>
  );
}
