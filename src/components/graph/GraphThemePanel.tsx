'use client';

/**
 * 图谱外观主题面板（U3-4）。
 *
 * 纯受控展示组件：环境 / 节点风格 / 光晕 / 背景强度全部由 props 传入，
 * 交互只通过回调上传，不自己读写 localStorage、不写 `<html data-graph-env>`、
 * 不发请求（持久化与 DOM 应用分别在 U3-5 / U3-1，接线由容器负责）。
 *
 * 布局约束：本面板挂在 300px 宽的设置面板「主题」tab 内，因此
 * - 环境卡固定 2×2（不用 lg:4 列，避免 300px 面板内每列过窄）；
 * - 节点风格为四段分段按钮；窄屏由父级面板自身限宽 + max-w 兜底。
 *
 * 无障碍：环境卡 / 风格按钮用 aria-pressed 表达选中态；滑块有 label +
 * 实时 `<output>`（如「1.0×」）；所有可点目标 ≥44px（min-h-11，G17 口径）。
 *
 * 配色只用现有 token（surface/elevated/app/line/accent 等）；
 * 环境卡的三个代表色是主题数据本身（graph-theme.ts 的 swatches），
 * 不在此处另造颜色。
 */
import { useId } from 'react';
import {
  GRAPH_ENVIRONMENTS,
  GRAPH_NODE_STYLES,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
} from '@/lib/graph/graph-theme';

export interface GraphThemePanelProps {
  environment: GraphEnvironmentId;
  nodeStyle: GraphNodeStyleId;
  /** 节点光晕强度倍率（0.5–1.8） */
  glow: number;
  /** 背景纹理/环境光强度倍率（0.4–1.5） */
  background: number;
  onEnvironmentChange: (id: GraphEnvironmentId) => void;
  onNodeStyleChange: (id: GraphNodeStyleId) => void;
  onGlowChange: (value: number) => void;
  onBackgroundChange: (value: number) => void;
  /** 传入时在面板底部显示「恢复默认外观」按钮 */
  onReset?: () => void;
}

const GLOW_MIN = 0.5;
const GLOW_MAX = 1.8;
const GLOW_STEP = 0.1;
const BACKGROUND_MIN = 0.4;
const BACKGROUND_MAX = 1.5;
const BACKGROUND_STEP = 0.1;

/** 小数位数：与 step=0.1 对齐，显示 1.0× / 1.3× 等定宽值 */
function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}×`;
}

interface IntensitySliderProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function IntensitySlider({ label, hint, value, min, max, step, onChange }: IntensitySliderProps) {
  const inputId = useId();

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-muted">
          {label}
        </label>
        <output htmlFor={inputId} className="font-mono text-minor tabular-nums text-primary">
          {formatMultiplier(value)}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={formatMultiplier(value)}
        className="mt-0.5 h-11 w-full cursor-pointer accent-accent"
      />
      <p className="text-tag text-faint">{hint}</p>
    </div>
  );
}

export default function GraphThemePanel({
  environment,
  nodeStyle,
  glow,
  background,
  onEnvironmentChange,
  onNodeStyleChange,
  onGlowChange,
  onBackgroundChange,
  onReset,
}: GraphThemePanelProps) {
  const environmentLabelId = useId();
  const nodeStyleLabelId = useId();

  const activeNodeStyle =
    GRAPH_NODE_STYLES.find((style) => style.id === nodeStyle) ?? GRAPH_NODE_STYLES[0];

  return (
    <section aria-label="图谱外观主题" className="w-full space-y-4 text-tag text-muted">
      {/* 1. 主题环境：2×2 可点卡片（label + 3 色点 + description） */}
      <div role="group" aria-labelledby={environmentLabelId}>
        <p
          id={environmentLabelId}
          className="mb-2 text-tag font-medium tracking-wide text-faint"
        >
          主题环境
        </p>
        <div className="grid grid-cols-2 gap-2">
          {GRAPH_ENVIRONMENTS.map((env) => {
            const selected = env.id === environment;

            return (
              <button
                key={env.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onEnvironmentChange(env.id)}
                className={`flex min-h-11 flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors duration-150 ${
                  selected
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-app/40 hover:border-line-strong hover:bg-surface-hover'
                }`}
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span className={`text-minor font-medium ${selected ? 'text-primary' : 'text-muted'}`}>
                    {env.label}
                  </span>
                  {selected && (
                    <span aria-hidden className="text-tag leading-none text-accent">
                      ✓
                    </span>
                  )}
                </span>
                <span aria-hidden className="flex items-center gap-1">
                  {env.swatches.map((color) => (
                    <span
                      key={color}
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-line-strong"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="text-tag leading-snug text-faint">{env.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. 节点风格：四段分段按钮 */}
      <div role="group" aria-labelledby={nodeStyleLabelId}>
        <p id={nodeStyleLabelId} className="mb-2 text-tag font-medium tracking-wide text-faint">
          节点风格
        </p>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-app/40 p-1">
          {GRAPH_NODE_STYLES.map((style) => {
            const selected = style.id === nodeStyle;

            return (
              <button
                key={style.id}
                type="button"
                aria-pressed={selected}
                title={style.description}
                onClick={() => onNodeStyleChange(style.id)}
                className={`min-h-11 min-w-0 rounded-md px-1 text-tag font-medium transition-colors duration-150 ${
                  selected
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:bg-surface-hover hover:text-primary'
                }`}
              >
                {style.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-tag text-faint">{activeNodeStyle.description}</p>
      </div>

      {/* 3. 光晕 / 背景强度：range + 当前倍率 */}
      <div className="space-y-3 border-t border-line pt-3">
        <IntensitySlider
          label="光晕强度"
          hint="节点外发光倍率"
          value={glow}
          min={GLOW_MIN}
          max={GLOW_MAX}
          step={GLOW_STEP}
          onChange={onGlowChange}
        />
        <IntensitySlider
          label="背景强度"
          hint="画布纹理与环境光倍率"
          value={background}
          min={BACKGROUND_MIN}
          max={BACKGROUND_MAX}
          step={BACKGROUND_STEP}
          onChange={onBackgroundChange}
        />
      </div>

      {/* 4. 可选：恢复默认外观 */}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-minor text-muted transition-colors duration-150 hover:border-line-strong hover:bg-surface-hover hover:text-primary"
        >
          <span aria-hidden>↺</span>
          恢复默认外观
        </button>
      )}

      <p className="text-tag leading-relaxed text-faint">
        切换即时生效，仅改变外观；记忆度配色与节点大小语义保持不变。
      </p>
    </section>
  );
}
