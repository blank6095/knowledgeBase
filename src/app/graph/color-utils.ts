/**
 * 图谱绘制用颜色工具：hex 与 hsl() 串统一解析为 rgb，并做同色相明暗混合。
 * memoryColor() 输出 hsl(h, s%, l%) 串，分组自定义色为 #hex——两条路径都走 parseColor。
 */

export type RGB = [number, number, number];

/** 解析颜色为 [r, g, b]：支持 #rgb / #rrggbb / hsl(h, s%, l%)，未知输入返回黑色 */
export function parseColor(input: string): RGB {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
    const n = Number.parseInt(hex, 16);
    if (Number.isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/^hsl\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*\)$/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return [0, 0, 0];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** 同色相明暗混合：amount>0 向白靠、<0 向黑靠（rgb 线性混合），返回 rgb() 串 */
export function shade(input: string, amount: number): string {
  const [r, g, b] = parseColor(input);
  const target = amount >= 0 ? 255 : 0;
  const p = Math.min(1, Math.abs(amount));
  const mix = (c: number) => Math.round(c + (target - c) * p);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * 色桶 key：hsl 输入按亮度 2%、饱和度 5% 量化（同桶节点的渐变差异肉眼不可辨），
 * 其余（分组 hex）取原值小写。用于 sprite 缓存的连续 hsl → 离散桶收敛。
 */
export function colorBucketKey(input: string): string {
  const m = input.trim().match(/^hsl\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  if (!m) return input.trim().toLowerCase();
  const h = Math.round(Number(m[1]));
  const s = Math.round(Number(m[2]) / 5) * 5;
  const l = Math.round(Number(m[3]) / 2) * 2;
  return `hsl(${h},${s}%,${l}%)`;
}
