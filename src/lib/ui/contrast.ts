/**
 * 对比度与颜色合成工具（纯函数，零依赖）。
 *
 * 用途：让「小字看不清」「亮底上的数字看不见」这类问题不再靠肉眼判断——
 * 颜色只要在本模块里计算对比度，就能被单测锁住，避免后续改色时回退。
 *
 * 遵循 WCAG 2.1 相对亮度与对比度公式；色值仅接受 #rgb / #rrggbb。
 */

export const AA_NORMAL = 4.5; // 正文级文字最低对比度
export const AA_LARGE = 3; // 大字号（≥18.66px 粗体 / 24px）最低对比度

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 解析十六进制颜色；非法输入抛错，避免把坏色值静默当成黑色 */
export function hexToRgb(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`非法十六进制颜色：${hex}`);
  }
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** 相对亮度（WCAG 2.1），范围 0–1 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 对比度（1–21），与顺序无关 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** 半透明前景叠在底色上的实际观感颜色（alpha 0–1） */
export function compositeOver(base: string, overlay: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const b = hexToRgb(base);
  const o = hexToRgb(overlay);
  return rgbToHex({
    r: o.r * a + b.r * (1 - a),
    g: o.g * a + b.g * (1 - a),
    b: o.b * a + b.b * (1 - a),
  });
}

/** 从候选前景色中挑对比度最高的一个（用于亮底/暗底自动选字色） */
export function bestContrastForeground(background: string, candidates: readonly string[]): string {
  if (candidates.length === 0) throw new Error('候选前景色不能为空');
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/** 是否满足 AA：正文级用 4.5，大字号用 3 */
export function meetsAA(background: string, foreground: string, large = false): boolean {
  return contrastRatio(background, foreground) >= (large ? AA_LARGE : AA_NORMAL);
}
