'use client';

/**
 * 图谱小地图（U4-6，可选功能）。
 *
 * - 168×112 缩略图：节点按记忆度着色（与主画布同色），视口矩形跟随相机；
 * - 点击/拖动小地图 → centerAt 到对应图坐标（不重排、不请求）；
 * - 8k 节点只采样 ≤1500 个点，静态点阵离屏缓存，视口矩形 350ms 刷新一次，避免逐帧重绘。
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { CanvasNode, FGInstance } from '@/lib/graph/graph-state';
import { computeBounds, projectToMinimap, unprojectFromMinimap, viewportRect, type GraphBounds } from '@/lib/graph/graph-minimap';
import { memoryColor } from '@/lib/memory';

export interface GraphMinimapProps {
  fgRef: RefObject<FGInstance | null>;
  nodes: readonly CanvasNode[];
  viewport: { w: number; h: number };
  width?: number;
  height?: number;
}

const MAX_DOTS = 1500;

export default function GraphMinimap({ fgRef, nodes, viewport, width = 168, height = 112 }: GraphMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<GraphBounds | null>(null);
  const draggingRef = useRef(false);

  // 静态点阵：nodes/尺寸变化时重建一次（离屏缓存）
  useEffect(() => {
    const bounds = computeBounds(nodes);
    boundsRef.current = bounds;
    if (!bounds) {
      staticRef.current = null;
      return;
    }
    const dpr = typeof window === 'undefined' ? 2 : Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const stride = Math.max(1, Math.ceil(nodes.length / MAX_DOTS));
    for (let i = 0; i < nodes.length; i += stride) {
      const node = nodes[i];
      if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
      const p = projectToMinimap(node.x, node.y, bounds, width, height);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = memoryColor(node.memory);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.9 + Math.min(1.6, Math.sqrt(node.degree ?? 0) / 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    staticRef.current = canvas;
  }, [nodes, width, height]);

  // 主画布：静态点阵 + 当前视口矩形
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const tick = () => {
      const bounds = boundsRef.current;
      ctx.clearRect(0, 0, width, height);
      if (!bounds) return;
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0, width, height);
      const fg = fgRef.current;
      if (!fg) return;
      const zoom = (fg.zoom as () => number)() as number;
      const center = (fg.centerAt as () => { x: number; y: number })();
      if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
      const rect = viewportRect(center, zoom, viewport, bounds, width, height);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#5cc8e6';
      ctx.fillStyle = `${accent}22`;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    };

    tick();
    const timer = setInterval(tick, 350);
    return () => {
      clearInterval(timer);
    };
  }, [fgRef, viewport, width, height]);

  const jumpTo = (clientX: number, clientY: number, duration: number) => {
    const canvas = canvasRef.current;
    const fg = fgRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !fg || !bounds) return;
    const rect = canvas.getBoundingClientRect();
    const px = Math.min(width, Math.max(0, clientX - rect.left));
    const py = Math.min(height, Math.max(0, clientY - rect.top));
    const target = unprojectFromMinimap(px, py, bounds, width, height);
    (fg.centerAt as (x: number, y: number, ms?: number) => unknown)(target.x, target.y, duration);
  };

  return (
    <div className="absolute bottom-24 right-3 z-20 overflow-hidden rounded-xl border border-line bg-surface/85 p-1.5 shadow-xl backdrop-blur md:bottom-24 md:right-4">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        role="img"
        aria-label="图谱小地图：显示全图和当前视口，点击或拖动可跳转"
        className="block cursor-crosshair touch-none rounded-md"
        style={{ width, height }}
        onPointerDown={(event) => {
          event.stopPropagation();
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          jumpTo(event.clientX, event.clientY, 200);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          event.stopPropagation();
          jumpTo(event.clientX, event.clientY, 0);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      />
      <p className="mt-1 px-1 text-center text-[0.65rem] leading-none text-faint">全景 · 点击跳转</p>
    </div>
  );
}
