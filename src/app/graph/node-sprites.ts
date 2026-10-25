/**
 * 节点光球 sprite 预渲染缓存。
 *
 * 「径向渐变 + shadowBlur 柔光」逐帧逐节点构造在数千节点下是主要绘制开销；
 * 这里按（色桶, 半径桶, 光晕档, 白热态）离屏渲染一次，drawNode 仅 drawImage。
 * 3× 超采样（位图预算 512px 封顶）配合页面 maxZoom=4：缩放在 4× 以内 sprite 不会被
 * 放大到明显失真；缓存上限 512，满则整体清空重建。
 * 色桶量化在页面预计算（colorBucketKey），本模块只消费 NodePaint。
 */
import { shade } from './color-utils';

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
const MAX_SPRITES = 512;
const SCALE = 3; // sprite 超采样倍率（上限受 MAX_BITMAP 约束）
const MAX_BITMAP = 512; // 单张 sprite 位图边长上限（px），防超大节点内存失控

const HOT_KEY = '__hot__';
/** 白热三档：中心近白 → accent-strong → 暗琥珀 */
const HOT_STOPS = ['#fff8ea', '#f2c069', shade('#e8b04b', -0.25)];
const HOT_GLOW_COLOR = 'rgba(242, 192, 105, 0.85)';

/** 半径桶：0.5px 步进 */
export const radiusBucket = (r: number) => Math.round(r * 2) / 2;
/** 光晕档：1px 步进 */
export const glowBucket = (g: number) => Math.round(g);

export function getNodeSprite(paint: NodePaint, r: number, glow: number, hot = false): HTMLCanvasElement {
  const key = `${hot ? HOT_KEY : paint.bucket}|${r}|${glow}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= MAX_SPRITES) cache.clear();

  const stops = hot ? HOT_STOPS : [paint.hi, paint.base, paint.lo];
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
  const grad = ctx.createRadialGradient(c, c, 0, c, c, r);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.6, stops[1]);
  grad.addColorStop(1, stops[2]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  cache.set(key, canvas);
  return canvas;
}

/** 以 (x, y) 为中心贴 sprite（按创建时记录的逻辑尺寸回贴，超采样自动缩回） */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number) {
  const w = Number(sprite.dataset.logical ?? sprite.width / SCALE);
  ctx.drawImage(sprite, x - w / 2, y - w / 2, w, w);
}
