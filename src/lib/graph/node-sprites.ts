/**
 * 节点 sprite 预渲染缓存（U3-3：4 种节点风格）。
 *
 * 「形状 + 渐变 + shadowBlur 柔光」逐帧逐节点构造在数千节点下是主要绘制开销；
 * 这里按（风格, 色桶, 半径桶, 光晕档, 白热态）离屏渲染一次，drawNode 仅 drawImage。
 * 3× 超采样（位图预算 512px 封顶）配合页面 maxZoom=4：缩放在 4× 以内 sprite 不会被
 * 放大到明显失真；缓存上限 768（4 风格共用，满则整体清空重建）。
 *
 * 铁律：风格只改形状/描边/外圈/光晕；记忆度对应的颜色由 NodePaint 决定，半径由
 * 调用方决定——两者不随风格改变。
 */
import { shade } from './color-utils';
import type { GraphNodeStyleId } from '@/lib/graph/graph-theme';

export interface NodePaint {
  /** 色桶 key（hsl 量化 / hex 原值），作缓存键的一部分 */
  bucket: string;
  /** 底色：60% stop 与柔光 shadowColor */
  base: string;
  /** 0% 提亮 stop（约 +18%） */
  hi: string;
  /** 100% 压暗 stop（约 -22%） */
  lo: string;
}

const cache = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 768;
const SCALE = 3; // sprite 超采样倍率（上限受 MAX_BITMAP 约束）
const MAX_BITMAP = 512; // 单张 sprite 位图边长上限（px），防超大节点内存失控

const HOT_KEY = '__hot__';
/** 白热三档：冷色高光（阶段 3 环境为冷色；记忆度颜色仍由 paint 决定） */
const HOT_STOPS: [string, string, string] = ['#effaff', '#8ee1f7', shade('#5cc8e6', -0.22)];
const HOT_GLOW_COLOR = 'rgba(142, 225, 247, 0.85)';

/** 半径桶：0.5px 步进 */
export const radiusBucket = (r: number) => Math.round(r * 2) / 2;
/** 光晕档：1px 步进 */
export const glowBucket = (g: number) => Math.round(g);

function paintStops(paint: NodePaint, hot: boolean): [string, string, string] {
  if (hot) return HOT_STOPS;
  return [paint.hi, paint.base, paint.lo];
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  style: GraphNodeStyleId,
  c: number,
  r: number,
  stops: [string, string, string],
): void {
  if (style === 'crystal') {
    // 晶体：菱形切面（线性渐变）+ 细描边
    const grad = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.55, stops[1]);
    grad.addColorStop(1, stops[2]);
    ctx.beginPath();
    ctx.moveTo(c, c - r);
    ctx.lineTo(c + r, c);
    ctx.lineTo(c, c + r);
    ctx.lineTo(c - r, c);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = stops[1];
    ctx.lineWidth = Math.max(0.8, r * 0.12);
    ctx.stroke();
    return;
  }

  if (style === 'wire') {
    // 线框：空心环 + 细描边（保留极淡填充以维持色相可辨）
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = stops[1];
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stops[0];
    ctx.lineWidth = Math.max(1, r * 0.3);
    ctx.stroke();
    return;
  }

  if (style === 'energy') {
    // 能量球：双环 + 径向中心核
    const core = ctx.createRadialGradient(c, c, 0, c, c, r * 0.72);
    core.addColorStop(0, stops[0]);
    core.addColorStop(0.55, stops[1]);
    core.addColorStop(1, stops[2]);
    ctx.beginPath();
    ctx.arc(c, c, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.strokeStyle = stops[0];
    ctx.lineWidth = Math.max(0.8, r * 0.14);
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = stops[2];
    ctx.lineWidth = Math.max(0.6, r * 0.08);
    ctx.beginPath();
    ctx.arc(c, c, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  // 光点（默认）：径向渐变光球
  const grad = ctx.createRadialGradient(c, c, 0, c, c, r);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.6, stops[1]);
  grad.addColorStop(1, stops[2]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
}

export function getNodeSprite(
  paint: NodePaint,
  r: number,
  glow: number,
  hot = false,
  style: GraphNodeStyleId = 'orb',
): HTMLCanvasElement {
  const key = `${style}|${hot ? HOT_KEY : paint.bucket}|${r}|${glow}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= MAX_SPRITES) cache.clear();

  const stops = paintStops(paint, hot);
  const glowColor = hot ? HOT_GLOW_COLOR : paint.base;
  const pad = glow * 2 + 2; // 柔光扩散余量
  const logical = Math.ceil((r + pad) * 2); // 直径 + 两侧余量
  // 实际超采样：常规节点 3×；超大节点（枢纽 + 悬停光晕）按位图预算收缩
  const eff = Math.max(1, Math.min(SCALE, MAX_BITMAP / logical));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(logical * eff);
  canvas.height = Math.round(logical * eff);
  canvas.dataset.logical = String(logical); // drawSprite 按此回贴逻辑尺寸
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(eff, eff);
  const c = logical / 2;
  if (glow > 0) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = glowColor;
  }
  drawShape(ctx, style, c, r, stops);
  cache.set(key, canvas);
  return canvas;
}

/** 以 (x, y) 为中心贴 sprite（按创建时记录的逻辑尺寸回贴，超采样自动缩回） */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number) {
  const w = Number(sprite.dataset.logical ?? sprite.width / SCALE);
  ctx.drawImage(sprite, x - w / 2, y - w / 2, w, w);
}
