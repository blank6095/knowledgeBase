'use client';

/**
 * 全站外壳（UQ2 拍板：用图谱的悬浮窄导航替换旧侧边栏）。
 *
 * - 桌面：左侧居中 56px 悬浮图标栏；移动：底部横向条（均由 GraphNavigation 渲染）。
 * - `/login` 不渲染外壳；`/graph` 为沉浸页，导航由 KnowledgeUniverse 自己渲染（避免重复）。
 * - 内容区为非沉浸页保留桌面左内边距与移动底部内边距，避免被固定导航遮挡。
 */
import { usePathname, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import GraphNavigation, { type GraphNavItem } from '@/components/graph/GraphNavigation';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/login') return <>{children}</>;

  /** 沉浸式页面（图谱）：隐藏全站导航与页脚，主列交给页面自己编排。 */
  const immersive = pathname === '/graph';
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  const items: GraphNavItem[] = [
    { key: 'universe', label: '知识宇宙', href: '/graph', active: active('/graph') },
    { key: 'library', label: '知识库', href: '/notes', active: active('/notes') },
    { key: 'today', label: '今日学习', href: '/', active: pathname === '/' },
    { key: 'progress', label: '学习复盘', href: '/progress', active: active('/progress') },
    { key: 'assistant', label: 'AI 助手', href: '/ask', active: active('/ask') },
    { key: 'appearance', label: '外观主题', disabled: true, hint: '进入知识宇宙后调整' },
    { key: 'settings', label: '设置', href: '/settings', active: active('/settings') },
  ];

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-app">
      {!immersive && <GraphNavigation items={items} onLogout={logout} />}
      <div className={immersive ? 'h-[100dvh] overflow-hidden' : 'flex min-h-screen flex-col'}>
        <main className={immersive ? 'h-full' : 'flex-1 px-4 pb-24 pt-3 md:py-6 md:pl-24 md:pr-6'}>{children}</main>
        {!immersive && (
          <footer className="border-t border-line py-3 text-center text-tag text-faint md:pl-24">
            知识宇宙 · Neon + Cloudflare R2 + Vercel
          </footer>
        )}
      </div>
    </div>
  );
}
