'use client';

/**
 * 图谱环境背景层（U0-3）。
 *
 * 「底色（容器 bg-canvas） + 纹理（本组件） + 画布（透明 Canvas）」三层中的纹理层：
 * 位于 Canvas 之下、不参与指针事件。第一版只用静态 CSS（渐变 + 噪点），
 * 禁视频/粒子/WebGL；真实环境切换 UI 属阶段 3 的 U3-4。
 *
 * `data-graph-env` 供后续主题系统与验收脚本切换环境；切换只改 CSS 绘制，
 * 不触碰业务数据、不触发力导向重排。
 */
export type GraphEnvironmentId = 'deep-space' | 'minimal';

export default function GraphBackground({ env = 'deep-space' }: { env?: GraphEnvironmentId }) {
  return <div aria-hidden="true" data-graph-env={env} className="graph-background" />;
}
