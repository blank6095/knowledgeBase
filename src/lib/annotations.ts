/**
 * 阅读标注的锚定与重定位（纯函数，前后端共用）。
 *
 * 锚点四元组 { quote, occurrence, prefix, suffix } 记录的是"段渲染文本"（textContent）：
 * - quote：选中的引文（已去首尾空白）
 * - occurrence：引文在段内第几次出现（1 起）
 * - prefix/suffix：引文前后各 ~20 字快照，供内容编辑后模糊重定位
 *
 * locate() 三级降级：精确（同 occurrence）→ 引文唯一/前后文吻合（模糊）→ 失效（null）。
 */

export type AnnotationKind = 'highlight' | 'note';
export type AnnotationColor = 'amber' | 'amberDeep' | 'neutral';

/** 色板（暗夜书房：琥珀两档 + 中性一档），mark 为半透明底色，dot 为列表/角标色 */
export const ANNOTATION_COLORS: Record<AnnotationColor, { mark: string; dot: string; label: string }> = {
  amber: { mark: 'rgba(232, 176, 75, 0.30)', dot: '#e8b04b', label: '琥珀' },
  amberDeep: { mark: 'rgba(217, 145, 92, 0.34)', dot: '#d9915c', label: '琥珀深' },
  neutral: { mark: 'rgba(164, 155, 140, 0.28)', dot: '#a49b8c', label: '中性' },
};

export const ANNOTATION_COLOR_ORDER: AnnotationColor[] = ['amber', 'amberDeep', 'neutral'];

export interface Anchor {
  quote: string;
  occurrence: number;
  prefix?: string | null;
  suffix?: string | null;
}

export interface LocateResult {
  start: number;
  end: number;
  /** true = 引文非原 occurrence 或靠前后文吻合定位 */
  fuzzy: boolean;
}

/** 引文前后快照各取的长度 */
const CONTEXT_LEN = 20;
/** 模糊匹配时比对的上下文片段长度 */
const FUZZY_WIN = 12;
/** 引文最小长度：低于它锚定不可靠，创建端应拒绝 */
export const MIN_QUOTE_LEN = 2;

export function contextOf(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: text.slice(end, end + CONTEXT_LEN),
  };
}

/** 在段渲染文本中定位锚点；找不到返回 null（失效标注） */
export function locate(anchor: Anchor, text: string): LocateResult | null {
  const q = anchor.quote.trim();
  if (q.length < MIN_QUOTE_LEN) return null;

  const positions: number[] = [];
  let from = 0;
  for (let i = text.indexOf(q, from); i !== -1; i = text.indexOf(q, from)) {
    positions.push(i);
    from = i + q.length;
  }

  // 1. 精确：同 occurrence
  if (positions.length >= anchor.occurrence) {
    const s = positions[anchor.occurrence - 1];
    return { start: s, end: s + q.length, fuzzy: false };
  }
  // 2a. 引文在段内唯一：occurrence 变了也能无歧义定位
  if (positions.length === 1) {
    return { start: positions[0], end: positions[0] + q.length, fuzzy: true };
  }
  // 2b. 前后文吻合：多处出现时用上下文快照挑选
  const pre = (anchor.prefix ?? '').trim().slice(-FUZZY_WIN);
  const suf = (anchor.suffix ?? '').trim().slice(0, FUZZY_WIN);
  for (const s of positions) {
    const before = text.slice(Math.max(0, s - FUZZY_WIN), s);
    const after = text.slice(s + q.length, s + q.length + FUZZY_WIN);
    const preOk = !pre || before.endsWith(pre) || before.includes(pre);
    const sufOk = !suf || after.startsWith(suf) || after.includes(suf);
    if (preOk && sufOk) return { start: s, end: s + q.length, fuzzy: true };
  }
  // 3. 失效
  return null;
}
