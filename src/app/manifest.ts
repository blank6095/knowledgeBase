import type { MetadataRoute } from 'next';

/**
 * PWA manifest（手机端「添加到主屏幕」/ standalone 启动）。
 * start_url 直接进知识宇宙；status bar 由 viewport-fit=cover + safe-area 处理。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '知识宇宙',
    short_name: '知识宇宙',
    description: '个人知识库：关系图谱、搜索、复习与 AI 助手',
    start_url: '/graph',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0a1020',
    theme_color: '#0a1020',
    lang: 'zh-CN',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
