/**
 * 确定性绘制指令生成 + Canvas 2D 绘制。
 *
 * 性能：视口裁剪、按令牌缓存绘制指令、标签上限、避免逐帧分配大对象。
 * 稳定性：绘制阶段逐命令错误隔离，单条失败不影响整帧与状态机。
 * 可测试性：buildDrawList 是纯函数，不需要 DOM；paintDrawList 接受注入的 ctx。
 */

import type { UniverseTokens } from './tokens';
import type { NodePaint, EdgePaint } from './visual';

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

export interface SceneNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly degree: number;
  readonly paint: NodePaint;
}

export interface SceneEdge {
  readonly source: string;
  readonly target: string;
  readonly key: string;
  readonly paint: EdgePaint;
}

export interface UniverseScene {
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
}

export type DrawCommand =
  | { readonly kind: 'background'; readonly width: number; readonly height: number; readonly frame: number }
  | { readonly kind: 'edge'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly paint: EdgePaint }
  | { readonly kind: 'node'; readonly x: number; readonly y: number; readonly radius: number; readonly paint: NodePaint }
  | { readonly kind: 'label'; readonly x: number; readonly y: number; readonly text: string; readonly paint: NodePaint };

export interface DrawList {
  readonly commands: readonly DrawCommand[];
  readonly visibleNodes: number;
  readonly culledNodes: number;
  readonly visibleLabels: number;
}

const CULL_MARGIN = 48;

function toScreen(x: number, y: number, viewport: Viewport): { x: number; y: number } {
  return {
    x: (x - viewport.centerX) * viewport.zoom + viewport.width / 2,
    y: (y - viewport.centerY) * viewport.zoom + viewport.height / 2,
  };
}

/** 纯函数：相同 scene + viewport + tokens + frame 产生完全相同的绘制指令。 */
export function buildDrawList(
  scene: UniverseScene,
  viewport: Viewport,
  tokens: UniverseTokens,
  frame = 0,
): DrawList {
  const commands: DrawCommand[] = [
    { kind: 'background', width: viewport.width, height: viewport.height, frame },
  ];

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of scene.nodes) positions.set(node.id, { x: node.x, y: node.y });

  let culled = 0;
  let labelCount = 0;
  const visible: SceneNode[] = [];

  for (const node of scene.nodes) {
    const p = toScreen(node.x, node.y, viewport);
    const r = node.radius * Math.max(0.1, viewport.zoom);
    if (
      p.x + r < -CULL_MARGIN ||
      p.x - r > viewport.width + CULL_MARGIN ||
      p.y + r < -CULL_MARGIN ||
      p.y - r > viewport.height + CULL_MARGIN
    ) {
      culled += 1;
      continue;
    }
    visible.push(node);
  }

  for (const edge of scene.edges) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;
    const a = toScreen(from.x, from.y, viewport);
    const b = toScreen(to.x, to.y, viewport);
    if (
      Math.max(a.x, b.x) < -CULL_MARGIN ||
      Math.min(a.x, b.x) > viewport.width + CULL_MARGIN ||
      Math.max(a.y, b.y) < -CULL_MARGIN ||
      Math.min(a.y, b.y) > viewport.height + CULL_MARGIN
    ) continue;
    commands.push({ kind: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y, paint: edge.paint });
  }

  // 标签按「选中 > 命中 > 关联度高」优先，受 maxLabels 上限约束。
  const labelCandidates = visible
    .filter((node) => node.paint.labelVisible)
    .sort((a, b) => {
      const priority = (node: SceneNode) => (node.paint.halo ? 2 : node.paint.opacity === 1 ? 1 : 0);
      return priority(b) - priority(a) || b.degree - a.degree;
    });

  for (const node of labelCandidates) {
    if (labelCount >= tokens.node.maxLabels) break;
    const p = toScreen(node.x, node.y, viewport);
    commands.push({ kind: 'label', x: p.x, y: p.y, text: node.paint.label, paint: node.paint });
    labelCount += 1;
  }

  for (const node of visible) {
    const p = toScreen(node.x, node.y, viewport);
    commands.push({
      kind: 'node',
      x: p.x,
      y: p.y,
      radius: Math.max(1.5, node.radius * Math.max(0.1, viewport.zoom)),
      paint: node.paint,
    });
  }

  return Object.freeze({
    commands: Object.freeze(commands) as readonly DrawCommand[],
    visibleNodes: visible.length,
    culledNodes: culled,
    visibleLabels: labelCount,
  });
}

function parseHex(hex: string): readonly [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return [117, 167, 255];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function withBrightness(hex: string, brightness: number): string {
  const [r, g, b] = parseHex(hex);
  const scale = Math.min(1, Math.max(0, brightness));
  return `rgb(${Math.round(r * scale + 255 * (1 - scale) * 0.12)}, ${Math.round(g * scale + 255 * (1 - scale) * 0.12)}, ${Math.round(b * scale + 255 * (1 - scale) * 0.12)})`;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  tokens: UniverseTokens,
  width: number,
  height: number,
  frame: number,
): void {
  ctx.fillStyle = tokens.palette.deepSpace;
  ctx.fillRect(0, 0, width, height);
  if (tokens.background === 'deep-space') return;

  if (tokens.background === 'cosmic-grid') {
    ctx.save();
    ctx.strokeStyle = 'rgba(117, 167, 255, 0.07)';
    ctx.lineWidth = 1;
    const step = 64;
    for (let x = 0; x <= width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Nebula：两个静态径向渐变，不做逐帧粒子计算。
  const drift = tokens.motion === 'light' ? Math.sin(frame / 90) * 12 : 0;
  const glow = ctx.createRadialGradient(
    width * 0.35 + drift,
    height * 0.4,
    0,
    width * 0.35 + drift,
    height * 0.4,
    Math.max(width, height) * 0.6,
  );
  glow.addColorStop(0, 'rgba(87, 76, 168, 0.20)');
  glow.addColorStop(1, 'rgba(8, 11, 22, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

/** 逐命令错误隔离；返回失败说明数组，空数组表示整帧绘制成功。 */
export function paintDrawList(
  ctx: CanvasRenderingContext2D,
  drawList: DrawList,
  tokens: UniverseTokens,
  frame = 0,
): readonly string[] {
  const errors: string[] = [];
  for (const command of drawList.commands) {
    let saved = false;
    try {
      ctx.save();
      saved = true;
      switch (command.kind) {
        case 'background':
          drawBackground(ctx, tokens, command.width, command.height, frame);
          break;
        case 'edge': {
          ctx.globalAlpha = command.paint.opacity;
          ctx.strokeStyle = command.paint.color;
          ctx.lineWidth = command.paint.width;
          ctx.beginPath();
          ctx.moveTo(command.x1, command.y1);
          ctx.lineTo(command.x2, command.y2);
          ctx.stroke();
          break;
        }
        case 'node': {
          const { paint } = command;
          ctx.globalAlpha = paint.opacity;
          ctx.fillStyle = withBrightness(tokens.palette.explore, paint.brightness);
          ctx.beginPath();
          ctx.arc(command.x, command.y, command.radius, 0, Math.PI * 2);
          ctx.fill();

          if (paint.ring === 'mastery') {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = tokens.palette.mastery;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(command.x, command.y, command.radius + 4, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (paint.marker === 'due') {
            ctx.globalAlpha = 1;
            ctx.fillStyle = tokens.palette.due;
            ctx.beginPath();
            ctx.arc(command.x + command.radius + 2, command.y - command.radius - 2, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
          if (paint.halo) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = tokens.palette.explore;
            ctx.lineWidth = 1.2;
            for (const extra of [5, 9]) {
              ctx.beginPath();
              ctx.arc(command.x, command.y, command.radius + extra, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          break;
        }
        case 'label': {
          ctx.globalAlpha = Math.max(0.35, command.paint.opacity);
          ctx.fillStyle = tokens.palette.text;
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(command.text, command.x, command.y - 12);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      errors.push(`${command.kind}: ${error instanceof Error ? error.message : '未知绘制错误'}`);
    } finally {
      if (saved) ctx.restore();
    }
  }
  return Object.freeze(errors);
}
