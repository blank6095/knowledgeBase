'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isAuthError } from '@/lib/client';
import InlineFeedback, { type FeedbackTone } from '@/components/InlineFeedback';

interface AiConfig {
  configured: boolean;
  model: string | null;
  fastModel?: string | null;
  keyTail: string | null;
  learnerDeclaration?: string;
  /**
   * 库内已存 Key 密文的可解密状态。configured=false 时用于区分
   * 「从未配置」与「配置还在、但因登录口令变更导致解不开」——后者必须重新填写 Key。
   */
  keyState?: 'unset' | 'ok' | 'key-mismatch';
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

/** 「测试当前输入」响应（UX-20）：不回显完整 Key，只给掩码后 4 位与真实测试结果 */
interface TestResult {
  ok: boolean;
  error?: string;
  reply?: string;
  model?: string;
  keyMask?: string | null;
  keySource?: 'draft' | 'saved' | null;
}

interface Feedback {
  tone: FeedbackTone;
  text: string;
}

/**
 * 配置读取状态机（FE-001）：
 * - loading：还没拿到服务端配置，禁止保存（否则会拿内存默认值覆盖已存配置）；
 * - ready：可保存；
 * - failed：读取失败，必须显式重试，且不能把「读取失败」当成「未配置」。
 */
type ConfigLoadState = 'loading' | 'ready' | 'failed';

/**
 * 服务端已存配置快照：保存时据此计算「本次实际改动了哪些字段」，
 * 只提交改动字段（PATCH 语义），未改动字段一律不写回。
 */
interface Baseline {
  /** 主模型 id */
  model: string;
  /** fast 档模型 id；'' = 同主模型 */
  fast: string;
  /** 学习者自述 */
  declaration: string;
}

const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

/** 应用内设置：LLM API Key（仅存服务端 DB，页面只显示尾 4 位）与模型选择，附连接测试 */
export default function SettingsPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [configLoadState, setConfigLoadState] = useState<ConfigLoadState>('loading');
  const [configError, setConfigError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelChoice, setModelChoice] = useState<string>(MODEL_OPTIONS[0]);
  const [customModel, setCustomModel] = useState('');
  const [fastChoice, setFastChoice] = useState<string>('');
  const [customFast, setCustomFast] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState('');
  /** 保存反馈与测试反馈分区展示，互不覆盖（FE-005） */
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null);
  /** 单一 busy：保存与测试互斥，任一进行中两个按钮同时禁用（FE-005） */
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);
  const [declaration, setDeclaration] = useState('');

  /**
   * 脏标记用 ref 而不是 state：配置回填是异步回调，读 state 会拿到挂载那一刻的旧值，
   * 正是 FE-004「回填覆盖用户刚做的选择」的根因。ref 在回调执行时读到的是最新值。
   */
  const dirtyRef = useRef({ model: false, fast: false, declaration: false });
  /** 服务端已存配置快照（保存时做 diff 用） */
  const baselineRef = useRef<Baseline | null>(null);
  /** 同步闸门：state 更新异步，双击时第二次点击可能读到旧 busy（FE-005） */
  const busyRef = useRef(false);

  /** 回填服务端配置；已被用户改过的字段不覆盖（FE-004） */
  const applyConfig = useCallback((c: AiConfig) => {
    setConfig(c);
    const model = c.model ?? '';
    const rawFast = c.fastModel ?? '';
    // fast 档与服务端一致（= 主模型）时归一为「同主模型」，与服务端 GET 口径一致
    const fast = rawFast && rawFast !== model ? rawFast : '';
    baselineRef.current = { model, fast, declaration: c.learnerDeclaration ?? '' };

    if (!dirtyRef.current.model) {
      if (!model) {
        setModelChoice(MODEL_OPTIONS[0]);
        setCustomModel('');
      } else if (MODEL_OPTIONS.includes(model)) {
        setModelChoice(model);
        setCustomModel('');
      } else {
        setModelChoice('custom');
        setCustomModel(model);
      }
    }
    if (!dirtyRef.current.fast) {
      if (!fast) {
        setFastChoice('');
        setCustomFast('');
      } else if (MODEL_OPTIONS.includes(fast)) {
        setFastChoice(fast);
        setCustomFast('');
      } else {
        setFastChoice('custom');
        setCustomFast(fast);
      }
    }
    if (!dirtyRef.current.declaration) {
      setDeclaration(c.learnerDeclaration ?? '');
    }
  }, []);

  /** 读取成功后：回填表单并进入 ready 态 */
  const handleLoaded = useCallback(
    (c: AiConfig) => {
      applyConfig(c);
      setConfigLoadState('ready');
    },
    [applyConfig],
  );

  /** 读取失败：进入 failed 态并展示错误，不伪装成「未配置」（FE-001） */
  const handleLoadError = useCallback((e: unknown) => {
    // 401 已由 api() 跳转登录，无需在此再报错
    if (isAuthError(e)) return;
    setConfigError(e instanceof Error ? e.message : '配置读取失败');
    setConfigLoadState('failed');
  }, []);

  /** 「重新加载」按钮：先回到 loading 态再请求 */
  const reloadConfig = useCallback(() => {
    setConfigLoadState('loading');
    setConfigError('');
    api<AiConfig>('/api/ai/config').then(handleLoaded).catch(handleLoadError);
  }, [handleLoaded, handleLoadError]);

  /** 保存成功后的静默回显刷新：失败不覆盖成功提示，也不回退到错误态 */
  const refreshConfig = useCallback(async () => {
    const c = await api<AiConfig>('/api/ai/config');
    applyConfig(c);
  }, [applyConfig]);

  useEffect(() => {
    let cancelled = false;
    api<AiConfig>('/api/ai/config')
      .then((c) => {
        if (!cancelled) handleLoaded(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) handleLoadError(e);
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
  }, [handleLoaded, handleLoadError]);

  const save = async () => {
    // 同步闸门 + 状态闸门：配置未就绪不保存，双击不产生第二次请求
    if (busyRef.current || configLoadState !== 'ready') return;
    const model = modelChoice === 'custom' ? customModel.trim() : modelChoice;
    // UX-19：选「自定义…」却没填模型 id 时禁止保存，避免空 model 入库后 LLM 调用必败
    if (modelChoice === 'custom' && !model) {
      setSaveFeedback({ tone: 'danger', text: '模型选「自定义」时必须填写模型 id，已取消保存' });
      return;
    }
    const fastModel = fastChoice === 'custom' ? customFast.trim() : fastChoice;
    const baseline = baselineRef.current;
    if (!baseline) return;

    // 只提交实际改动的字段：未改动字段不写，服务端按 PATCH 语义保持原值
    const body: Record<string, string> = {};
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (model !== baseline.model) body.model = model;
    if (fastModel !== baseline.fast) {
      body.fastModel = fastModel;
    } else if (model !== baseline.model && baseline.fast === '') {
      // fast 档原本跟随主模型：主模型变更后要显式清除，避免库里残留的旧 fast 值继续生效
      body.fastModel = '';
    }
    if (declaration !== baseline.declaration) body.learnerDeclaration = declaration;

    busyRef.current = true;
    setBusy('saving');
    setSaveFeedback(null);
    try {
      const r = await api<{
        model: string;
        fastModel?: string;
        keyTail: string | null;
        learnerDeclaration?: string;
      }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setApiKey('');
      setSaveFeedback({
        tone: 'success',
        text: `已保存（模型 ${r.model}${r.fastModel && r.fastModel !== r.model ? ` · fast 档 ${r.fastModel}` : ''}${r.keyTail ? ` · Key 尾号 ****${r.keyTail}` : ''}）`,
      });
      try {
        await refreshConfig();
      } catch {
        // 保存已成功；回显刷新失败不覆盖成功提示，下次进入设置页会重新读取
      }
    } catch (e) {
      // 401 已由 api() 跳转登录，不再显示自相矛盾的「请求失败」
      if (!isAuthError(e)) setSaveFeedback({ tone: 'danger', text: e instanceof Error ? e.message : '保存失败' });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const testConnection = async () => {
    if (busyRef.current) return;
    const model = modelChoice === 'custom' ? customModel.trim() : modelChoice;
    if (modelChoice === 'custom' && !model) {
      setTestFeedback({ tone: 'danger', text: '模型选「自定义」时必须填写模型 id，才能测试连接' });
      return;
    }
    const fastModel = fastChoice === 'custom' ? customFast.trim() : fastChoice;
    busyRef.current = true;
    setBusy('testing');
    setTestFeedback(null);
    try {
      // UX-20：把输入框里的草稿值随请求发送，服务端用它们真实测试一次且不落库；
      // 空串不发送（等价于未传），避免用空值覆盖已保存的 Key / 模型。
      const r = await api<TestResult>('/api/ai/test', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          model: model || undefined,
          // 未单独选 fast 档时界面语义是「同主模型」，显式发送主模型而不是让服务端回退到旧的已保存 fast 档
          fastModel: fastModel || model || undefined,
        }),
      });
      if (r.ok) {
        setTestFeedback({
          tone: 'success',
          text: `连接可用（模型 ${r.model ?? model}${r.keyMask ? ` · Key ${r.keyMask}` : ''}）`,
        });
      } else {
        setTestFeedback({ tone: 'danger', text: `连接不可用：${r.error ?? '未知原因'}` });
      }
    } catch (e) {
      if (!isAuthError(e)) setTestFeedback({ tone: 'danger', text: e instanceof Error ? e.message : '连接失败' });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const saving = busy === 'saving';
  const testing = busy === 'testing';
  // 配置未就绪时禁止保存：读取失败时保存会把内存默认值写回，覆盖已存配置（FE-001）
  const saveDisabled = saving || configLoadState !== 'ready';

  return (
    <div className="mx-auto max-w-form space-y-5">
      <div className="fade-up">
        <h1 className="font-display text-title font-semibold">设置</h1>
        <p className="mt-1.5 text-minor text-muted">
          大模型接入用于编辑态的语义拆解/聚合与「问知识库」。API Key 只保存在服务端数据库，页面与接口均不回显明文。
        </p>
      </div>

      <section className="card fade-up space-y-4 px-5 py-4" style={{ animationDelay: '80ms' }}>
        {configLoadState === 'loading' && (
          <p className="text-tag text-muted" role="status">
            正在读取当前配置…
          </p>
        )}

        {configLoadState === 'failed' && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5">
            <p className="text-tag font-medium text-danger">配置读取失败</p>
            <p className="mt-1 text-tag leading-relaxed text-muted">
              {configError || '未能读取服务端配置，请检查网络后重试。'}
              <span className="mt-1 block text-faint">为避免覆盖已保存的模型与学习者自述，配置读取成功前无法保存。</span>
            </p>
            <button
              type="button"
              onClick={reloadConfig}
              className="mt-2 min-h-11 rounded-lg border border-line px-3 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              重新加载
            </button>
          </div>
        )}

        {config?.keyState === 'key-mismatch' && (
          <InlineFeedback tone="warn">
            库内已保存的 API Key 当前无法解密——通常是登录口令变更后，加密主密钥随之变化所致。
            请重新填写 API Key 并保存。
          </InlineFeedback>
        )}

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
              onChange={(e) => {
                dirtyRef.current.model = true;
                setModelChoice(e.target.value);
              }}
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
                onChange={(e) => {
                  dirtyRef.current.model = true;
                  setCustomModel(e.target.value);
                }}
                placeholder="输入模型 id"
                className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-2 font-mono text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
              />
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-tag text-faint">fast 档（摘要/测试连接）</span>
            <select
              value={fastChoice}
              onChange={(e) => {
                dirtyRef.current.fast = true;
                setFastChoice(e.target.value);
              }}
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
                onChange={(e) => {
                  dirtyRef.current.fast = true;
                  setCustomFast(e.target.value);
                }}
                placeholder="fast 档模型 id"
                className="min-w-40 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 font-mono text-tag text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
              />
            )}
          </div>
        </div>

        <div>
          <p className="text-tag uppercase text-faint">学习者自述（可选，供 AI 个性化）</p>
          <textarea
            value={declaration}
            onChange={(e) => {
              dirtyRef.current.declaration = true;
              setDeclaration(e.target.value);
            }}
            rows={3}
            maxLength={500}
            placeholder="如：后端方向求职，正在补计算机网络与 Node.js；喜欢先看结论再看细节。会随「问知识库」与 AI 拆解/聚合注入，使回答与拆解粒度贴合你的目标。"
            className="mt-1.5 w-full resize-y rounded-lg border border-line bg-app px-3 py-2 text-minor leading-relaxed text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saveDisabled}
            className="min-h-11 rounded-lg bg-accent px-4 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={busy !== null}
            title="用上方输入框里的 Key 与模型发一次最小请求，验证连通性（不保存配置）"
            className="min-h-11 rounded-lg border border-line px-4 py-1.5 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试当前输入'}
          </button>
          <span className="text-tag text-faint">无需先保存；Key 留空则用已保存的 Key 测试</span>
        </div>

        {saveFeedback && <InlineFeedback tone={saveFeedback.tone}>{saveFeedback.text}</InlineFeedback>}

        {testFeedback && (
          <div className="rounded-lg border border-line bg-app/60 px-3 py-2">
            <p className="text-tag uppercase text-faint">连接测试</p>
            <InlineFeedback tone={testFeedback.tone} className="mt-1">
              {testFeedback.text}
            </InlineFeedback>
          </div>
        )}

        <p className="border-t border-line pt-3 text-tag leading-relaxed text-faint">
          配置即存即用，无需重启。DeepSeek 接口地址 https://api.deepseek.com（OpenAI 兼容），在
          api-docs.deepseek.com 申请 API Key。
          {config && !config.configured && config.keyState !== 'key-mismatch' && ' 当前未配置——「问知识库」与编辑态的 AI 拆解/聚合暂不可用。'}
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
              className="mt-2 min-h-11 rounded-lg border border-line px-3 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
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
