'use client';

/**
 * 图谱环境背景层（U0-3 / U3-2）。
 *
 * 「底色（容器 bg-canvas） + 纹理（本组件） + 画布（透明 Canvas）」三层中的纹理层：
 * 位于 Canvas 之下、不参与指针事件；4 套冷色环境由 CSS 静态渐变/网格实现，
 * 禁视频/粒子/WebGL。切换只改 CSS 与 opacity，不触碰业务数据、不触发力导向重排。
 */
import type { GraphEnvironmentId } from '@/lib/graph/graph-theme';

export type { GraphEnvironmentId };

export default function GraphBackground({
  env = 'deep-space',
  intensity = 1,
}: {
  env?: GraphEnvironmentId;
  /** 背景强度 0.4–1.5（偏好 U3-4 实时调节） */
  intensity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      data-graph-env={env}
      className="graph-background"
      style={{ opacity: Math.min(1.5, Math.max(0.4, intensity)) }}
    />
  );
}
