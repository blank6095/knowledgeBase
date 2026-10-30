/**
 * 主题色单一出口（与 src/app/globals.css 的 @theme 保持同步）。
 *
 * 为什么需要它：CSS 变量无法被 Canvas / 内联 style 读取，此前热力图底色、
 * 标注默认色、图谱分组色各自硬编码，且靠注释人工同步，必然漂移。
 * 这里把「需要在 JS 里用到的色值」集中定义，并由单测校验它们与 CSS 的对比度要求。
 *
 * 同步约定：改动 globals.css 中的 @theme 色值时，必须同步本文件（单测会校验对比度，但不会校验两者字面相等）。
 */

export const PALETTE = {
  /** 应用底色 */
  app: '#131110',
  /** 卡片/面板 */
  surface: '#1b1815',
  /** 卡片 hover */
  surfaceHover: '#242019',
  /** 浮层：设置面板/下拉/tooltip */
  elevated: '#2a251e',
  /** 图谱画布 */
  canvas: '#0f0d0b',
  /** 暖白正文 */
  primary: '#ece6da',
  /** 次要文字 */
  muted: '#a49b8c',
  /** 弱文字（功能性说明也用它，已满足 AA） */
  faint: '#948b7d',
  /** 纯装饰弱色：仅用于序号、分隔线等不影响阅读的内容 */
  faintDecor: '#6e675c',
  /** 琥珀：灯光/激活/主按钮 */
  accent: '#e8b04b',
  /** 琥珀高亮 */
  accentStrong: '#f2c069',
  /** 琥珀底上的文字 */
  accentInk: '#201708',
  danger: '#e07a6a',
  success: '#8fb573',
  warn: '#d9915c',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** 三种主要底色：功能性文字必须在这三张底上都可读 */
export const SURFACE_BACKGROUNDS = [PALETTE.app, PALETTE.surface, PALETTE.elevated] as const;

/** 亮底（如热力图高亮格）上应使用的前景色：与主色对比度更高 */
export const LIGHT_BACKGROUND_FOREGROUNDS = [PALETTE.accentInk, PALETTE.app, PALETTE.primary] as const;
