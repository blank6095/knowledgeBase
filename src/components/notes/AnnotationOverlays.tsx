'use client';

/**
 * 文档阅读页的标注浮层（选区操作 / 标注查看卡 / 节级笔记 / AI 解释）。
 *
 * 从 notes/[id]/page.tsx 抽出：这四块浮层共同点是「固定定位在视口、只消费上层状态、
 * 通过回调把写操作交回容器」，与文档加载、阅读时长采集、目录导航等关注点正交。
 * 抽成纯展示组件后，页面不再混杂大段浮层 JSX。
 *
 * 行为与抽取前完全一致：所有状态与写操作仍由容器持有，浮层只负责渲染与转发。
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AiOverlay from '@/components/AiOverlay';
import InlineFeedback from '@/components/InlineFeedback';
import { formatDate } from '@/lib/client';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_ORDER,
  type AnnotationColor,
  type AnnotationKind,
} from '@/lib/annotations';
import { clampPopover, POPOVER_WIDTH, type PopoverPosition } from '@/lib/ui/geometry';

/** 选区产生的标注锚点（在段渲染文本上的四元组） */
export interface SelAnchor {
  x: number;
  y: number;
  segId: string;
  quote: string;
  occurrence: number;
  prefix: string;
  suffix: string;
}

/** 标注行（查看卡展示所需字段） */
export interface AnnotationRow {
  id: string;
  segmentId: string;
  kind: AnnotationKind;
  quote: string | null;
  occurrence: number;
  prefix: string | null;
  suffix: string | null;
  note: string | null;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
  segmentTitle: string;
  segmentOrder: number;
}

/** AI 解释结果 */
export interface ExplainData {
  quote: string;
  explanation: string;
  segmentTitle: string;
}

const excerpt = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 浮层尺寸估算：用于碰撞计算（实际渲染宽度与 POPOVER_WIDTH 一致） */
export const POP_SIZE = {
  color: { width: 220, height: 44 },
  note: { width: POPOVER_WIDTH, height: 220 },
  card: { width: POPOVER_WIDTH, height: 190 },
} as const;

/** 视口尺寸：浮层碰撞计算需要（SSR 阶段为 0，此时按锚点原样渲染） */
export interface Viewport {
  width: number;
  height: number;
}

/** 浮层定位：保证不越界；空间不足时自动翻转/贴边 */
export function popPosition(
  viewport: Viewport,
  x: number,
  y: number,
  size: { width: number; height: number },
): PopoverPosition {
  return viewport.width > 0 && viewport.height > 0
    ? clampPopover({
        anchorX: x,
        anchorY: y,
        width: size.width,
        height: size.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      })
    : { left: x, top: y, placement: 'bottom' as const, clampedX: false, flipped: false };
}

export interface SelectionPopoverProps {
  selPop: SelAnchor | null;
  popMode: 'color' | 'note';
  viewport: Viewport;
  noteText: string;
  noteColor: AnnotationColor;
  annoMsg: string;
  explainBusy: boolean;
  onPopModeChange: (mode: 'color' | 'note') => void;
  onNoteTextChange: (text: string) => void;
  onNoteColorChange: (color: AnnotationColor) => void;
  onCreateAnnotation: (kind: AnnotationKind, color: AnnotationColor, text?: string) => void;
  onExplainSelection: () => void;
  onClose: () => void;
}

/** 选区浮层：先选颜色/写笔记，再触发 AI 解释 */
export function SelectionPopover({
  selPop,
  popMode,
  viewport,
  noteText,
  noteColor,
  annoMsg,
  explainBusy,
  onPopModeChange,
  onNoteTextChange,
  onNoteColorChange,
  onCreateAnnotation,
  onExplainSelection,
  onClose,
}: SelectionPopoverProps) {
  if (!selPop) return null;
  const pos = popPosition(viewport, selPop.x, selPop.y, popMode === 'color' ? POP_SIZE.color : POP_SIZE.note);
  return (
    <div data-anno-pop className="fixed z-50" style={{ left: pos.left, top: pos.top }}>
      {popMode === 'color' ? (
        <div className="flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1.5 shadow-xl">
          {ANNOTATION_COLOR_ORDER.map((c) => (
            <button
              key={c}
              title={`划线 · ${ANNOTATION_COLORS[c].label}`}
              aria-label={`划线 · ${ANNOTATION_COLORS[c].label}`}
              onClick={() => onCreateAnnotation('highlight', c)}
              className="h-5 w-5 rounded-full border border-line-strong transition-transform duration-150 hover:scale-110"
              style={{ background: ANNOTATION_COLORS[c].dot }}
            />
          ))}
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button
            onClick={() => onPopModeChange('note')}
            className="rounded px-1.5 py-0.5 text-tag text-muted transition-colors duration-150 hover:text-primary"
          >
            ✎ 笔记
          </button>
          <button
            onClick={onExplainSelection}
            disabled={explainBusy}
            className="rounded px-1.5 py-0.5 text-tag text-accent transition-colors duration-150 hover:text-accent-strong disabled:opacity-50"
          >
            {explainBusy ? '解释中…' : '✦ 解释'}
          </button>
        </div>
      ) : (
        <div className="w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-elevated p-2.5 shadow-xl">
          <p className="mb-1.5 truncate text-tag text-muted" title={selPop.quote}>
            “{excerpt(selPop.quote, 60)}”
          </p>
          <textarea
            value={noteText}
            onChange={(e) => onNoteTextChange(e.target.value)}
            rows={3}
            autoFocus
            className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
            placeholder="写下想法…"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            {ANNOTATION_COLOR_ORDER.map((c) => (
              <button
                key={c}
                aria-label={ANNOTATION_COLORS[c].label}
                onClick={() => onNoteColorChange(c)}
                className={`h-4 w-4 rounded-full border ${noteColor === c ? 'border-accent' : 'border-line-strong'}`}
                style={{ background: ANNOTATION_COLORS[c].dot }}
              />
            ))}
            <div className="flex-1" />
            <button onClick={onClose} className="inline-flex min-h-11 items-center rounded px-2 text-tag text-muted transition-colors duration-150 hover:text-primary">
              取消
            </button>
            <button
              onClick={() => onCreateAnnotation('note', noteColor, noteText)}
              className="inline-flex min-h-11 items-center rounded bg-accent px-2.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
            >
              保存
            </button>
          </div>
          {annoMsg && (
            <div className="mt-1">
              <InlineFeedback tone="danger">{annoMsg}</InlineFeedback>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface AnnotationViewCardProps {
  viewCard: { x: number; y: number; ann: AnnotationRow } | null;
  viewport: Viewport;
  annoListMsg: string;
  onDeleteAnnotation: (id: string) => void;
}

/** 标注查看卡：展示引文/笔记与删除入口 */
export function AnnotationViewCard({ viewCard, viewport, annoListMsg, onDeleteAnnotation }: AnnotationViewCardProps) {
  if (!viewCard) return null;
  const pos = popPosition(viewport, viewCard.x, viewCard.y, POP_SIZE.card);
  return (
    <div
      data-anno-pop
      className="fixed z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-elevated p-3 shadow-xl"
      style={{ left: pos.left, top: pos.top }}
    >
      {viewCard.ann.quote && (
        <p className="mb-1.5 border-l-2 border-accent/50 pl-2 text-minor leading-relaxed text-muted">{excerpt(viewCard.ann.quote, 90)}</p>
      )}
      {viewCard.ann.note && <p className="whitespace-pre-wrap text-body leading-relaxed text-primary">{viewCard.ann.note}</p>}
      <p className="mt-2 flex items-center justify-between gap-2 text-tag text-muted">
        <span className="truncate">
          {formatDate(viewCard.ann.createdAt)} · {viewCard.ann.segmentTitle}
        </span>
        <button onClick={() => onDeleteAnnotation(viewCard.ann.id)} className="shrink-0 transition-colors duration-150 hover:text-danger">
          删除
        </button>
      </p>
      {annoListMsg && (
        <div className="mt-1">
          <InlineFeedback tone="danger">{annoListMsg}</InlineFeedback>
        </div>
      )}
    </div>
  );
}

export interface SectionNotePopoverProps {
  secNote: { x: number; y: number; segId: string } | null;
  viewport: Viewport;
  secNoteText: string;
  secNoteMsg: string;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** 节级笔记编辑弹层 */
export function SectionNotePopover({
  secNote,
  viewport,
  secNoteText,
  secNoteMsg,
  onTextChange,
  onSave,
  onClose,
}: SectionNotePopoverProps) {
  if (!secNote) return null;
  const pos = popPosition(viewport, secNote.x, secNote.y, POP_SIZE.note);
  return (
    <div
      data-anno-pop
      className="fixed z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-elevated p-2.5 shadow-xl"
      style={{ left: pos.left, top: pos.top }}
    >
      <textarea
        value={secNoteText}
        onChange={(e) => onTextChange(e.target.value)}
        rows={3}
        autoFocus
        className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
        placeholder="本节笔记…"
      />
      <div className="mt-1.5 flex justify-end gap-2">
        <button onClick={onClose} className="inline-flex min-h-11 items-center rounded px-2 text-tag text-muted transition-colors duration-150 hover:text-primary">
          取消
        </button>
        <button
          onClick={onSave}
          disabled={!secNoteText.trim()}
          className="inline-flex min-h-11 items-center rounded bg-accent px-2.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          保存
        </button>
      </div>
      {secNoteMsg && (
        <div className="mt-1">
          <InlineFeedback tone="danger">{secNoteMsg}</InlineFeedback>
        </div>
      )}
    </div>
  );
}

export interface ExplainOverlayProps {
  explainData: ExplainData | null;
  onClose: () => void;
}

/** AI 解释浮层：展示引文原文与解释正文 */
export function ExplainOverlay({ explainData, onClose }: ExplainOverlayProps) {
  if (!explainData) return null;
  return (
    <AiOverlay
      title="AI 解释这段"
      subtitle={explainData.segmentTitle}
      onClose={onClose}
      footer={
        <button
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-minor text-muted hover:bg-surface-hover hover:text-primary"
        >
          关闭
        </button>
      }
    >
      <p className="border-l-2 border-accent/40 pl-3 text-minor leading-relaxed text-faint">
        “{explainData.quote}”
      </p>
      <div className="md-body mt-4 text-body">
        <Markdown remarkPlugins={[remarkGfm]}>{explainData.explanation}</Markdown>
      </div>
    </AiOverlay>
  );
}
