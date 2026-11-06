'use client';

/**
 * 图谱右侧知识详情面板（U1-5）。
 *
 * 纯展示组件：数据、加载/错误态与五个操作全部由 KnowledgeUniverse 传入；
 * 桌面固定右栏，移动端为底部 Drawer（限高可滚动）。可点区域 ≥44px（G17）。
 */
import { useState } from 'react';
import InlineFeedback from '@/components/InlineFeedback';
import { previewNeighbors } from '@/lib/graph/graph-neighbor-preview';
import { MEMORY_TIER_LABELS, memoryTier } from '@/lib/memory';

export interface GraphDetailNeighbor {
  id: string;
  title: string;
  kind: string;
  memory: number;
}

export interface GraphDetailData {
  id: string;
  title: string;
  documentTitle: string | null;
  headingPath: string;
  memory: number;
  tags: string[];
  summary: string | null;
  neighborCount: number;
  neighbors: GraphDetailNeighbor[];
}

export interface GraphDetailPanelProps {
  status: 'loading' | 'error' | 'ok';
  data: GraphDetailData | null;
  error?: string;
  /** 图谱节点名：详情接口返回前/失败时用作标题（FE-009） */
  title?: string;
  /** 0=未展开；1=一阶邻居；2=二阶邻居（U4-1 循环切换） */
  focusDepth: 0 | 1 | 2;
  onClose: () => void;
  onRetry: () => void;
  onRead: () => void;
  onReview: () => void;
  onEdit: () => void;
  onCycleFocus: () => void;
  onAsk: () => void;
  onSelectNeighbor: (id: string) => void;
}

const KIND_LABELS: Record<string, string> = { wiki: '双链', tag: '标签', doc: '同文档' };

const ACTION_BUTTON =
  'flex min-h-11 items-center justify-center rounded-lg px-3 text-tag font-medium transition-colors duration-150';

export default function GraphDetailPanel({
  status,
  data,
  error,
  title,
  focusDepth,
  onClose,
  onRetry,
  onRead,
  onReview,
  onEdit,
  onCycleFocus,
  onAsk,
  onSelectNeighbor,
}: GraphDetailPanelProps) {
  /**
   * 记录哪个节点处于「展开全部」状态。用 id 而非布尔值：
   * 切换到另一个节点时自动收起，不必额外 effect 重置。
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = data !== null && expandedId === data.id;
  const neighbors = data?.neighbors ?? [];
  // UX-12：默认 8 条 +「展开全部 / 收起」，>8 条的关联同样可达
  const { visible: visibleNeighbors, hasMore: hasMoreNeighbors } = previewNeighbors(neighbors, expanded);

  return (
    <aside
      aria-label="知识点详情"
      className="absolute inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 max-h-[60%] overflow-y-auto rounded-t-2xl border border-line bg-elevated/95 p-4 shadow-2xl backdrop-blur md:inset-y-3 md:left-auto md:right-safe-3 md:bottom-3 md:max-h-none md:w-[380px] md:rounded-xl"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-tag uppercase tracking-wide text-faint">知识点</p>
          <h2 className="mt-1 font-display text-card font-semibold leading-snug text-primary">
            {/* FE-009：加载中/失败时也显示节点名，不再一直停在「加载中…」 */}
            {(status === 'ok' && data ? data.title : title) ?? (status === 'loading' ? '加载中…' : '知识点详情')}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
        >
          ✕
        </button>
      </div>

      {status === 'loading' && (
        <div className="mt-4 space-y-2" role="status" aria-label="详情加载中">
          <div className="skeleton h-3 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
          <div className="skeleton h-16 w-full" />
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 space-y-3">
          <InlineFeedback tone="danger">{error ?? '知识点详情加载失败'}</InlineFeedback>
          <button
            type="button"
            onClick={onRetry}
            className={`${ACTION_BUTTON} w-full bg-accent text-accent-ink hover:bg-accent-strong`}
          >
            重试
          </button>
        </div>
      )}

      {status === 'ok' && data && (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-tag text-muted">
            <span>{data.documentTitle ?? '未归入文档'}</span>
            <span className="text-faint">·</span>
            <span>
              记忆度 <b className="text-accent-strong">{MEMORY_TIER_LABELS[memoryTier(data.memory)]}</b>
              <span className="ml-1 text-faint">{(data.memory * 100).toFixed(0)}%</span>
            </span>
            <span className="text-faint">·</span>
            <span>关联 {data.neighborCount}</span>
          </div>

          {data.headingPath && <p className="text-tag text-faint">路径：{data.headingPath}</p>}

          {data.summary ? (
            <p className="rounded-lg border border-line bg-app/60 px-3 py-2 text-minor leading-relaxed text-muted">
              {data.summary}
            </p>
          ) : (
            <p className="text-tag text-faint">暂无摘要（首次查看灯点摘要卡时生成）</p>
          )}

          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-tag text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div>
            <p className="text-tag uppercase tracking-wide text-faint">直接关联</p>
            {neighbors.length === 0 ? (
              <p className="mt-1.5 text-tag text-faint">暂无直接关联</p>
            ) : (
              <>
                <ul className="mt-1.5 space-y-1">
                  {visibleNeighbors.map((neighbor) => (
                    <li key={`${neighbor.kind}-${neighbor.id}`}>
                      <button
                        type="button"
                        onClick={() => onSelectNeighbor(neighbor.id)}
                        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
                      >
                        <span className="min-w-0 flex-1 truncate">{neighbor.title}</span>
                        <span className="shrink-0 text-tag text-faint">{KIND_LABELS[neighbor.kind] ?? neighbor.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hasMoreNeighbors && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : data?.id ?? null)}
                    className="mt-1 flex min-h-11 w-full items-center justify-center rounded-lg border border-line text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
                  >
                    {expanded ? '收起' : `展开全部（${neighbors.length}）`}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
            <button type="button" onClick={onRead} className={`${ACTION_BUTTON} bg-accent text-accent-ink hover:bg-accent-strong`}>
              阅读知识
            </button>
            <button type="button" onClick={onReview} className={`${ACTION_BUTTON} border border-line text-muted hover:bg-surface-hover hover:text-primary`}>
              开始复习
            </button>
            <button
              type="button"
              onClick={onCycleFocus}
              aria-pressed={focusDepth > 0}
              className={`${ACTION_BUTTON} border ${
                focusDepth > 0
                  ? 'border-accent bg-accent/10 text-accent-strong'
                  : 'border-line text-muted hover:bg-surface-hover hover:text-primary'
              }`}
            >
              {focusDepth === 2 ? '收起关联' : focusDepth === 1 ? '展开二阶关联' : '展开一阶关联'}
            </button>
            <button type="button" onClick={onAsk} className={`${ACTION_BUTTON} border border-line text-muted hover:bg-surface-hover hover:text-primary`}>
              AI 解释
            </button>
            <button
              type="button"
              onClick={onEdit}
              className={`${ACTION_BUTTON} col-span-2 border border-line text-muted hover:bg-surface-hover hover:text-primary`}
            >
              编辑知识点
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
