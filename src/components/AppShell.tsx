'use client';

/**
 * 全站外壳（UQ2 拍板：用图谱的悬浮窄导航替换旧侧边栏）。
 *
 * - 桌面：左侧居中 56px 悬浮图标栏；移动：底部横向条（均由 GraphNavigation 渲染）。
 * - 移动端紧凑导航（UX-01）：底部只留「知识宇宙 / 知识库 / AI 助手」3 个核心入口 +「更多」，
 *   其余入口（含退出登录）收进「更多」抽屉，把触控目标从 ~35–42px 提到 ≥44px。
 * - `/login` 不渲染外壳；`/graph` 为沉浸页，导航由 KnowledgeUniverse 自己渲染（避免重复）。
 * - 全站 Ctrl/Cmd+K 打开检索浮层（UX-35）：`/graph` 由图谱内搜索接管；页脚给出移动端可见入口。
 * - 内容区为非沉浸页保留桌面左内边距与移动底部内边距；页脚同样让出固定导航高度（UX-04）。
 */
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import GraphNavigation, { type GraphNavItem } from '@/components/graph/GraphNavigation';
import QuickSwitcher from '@/components/QuickSwitcher';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

/**
 * 导航入口（纯函数，便于单测锁定 UX-01 紧凑结构与 U-6 的「外观主题」跳转参数）。
 * active 由当前 pathname 推导；`/graph?panel=theme` 只带参数打开主题面板，不算「知识宇宙」高亮。
 */
export function buildNavItems(pathname: string): GraphNavItem[] {
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return [
    { key: 'universe', label: '知识宇宙', href: '/graph', active: active('/graph') },
    { key: 'library', label: '知识库', href: '/notes', active: active('/notes') },
    { key: 'today', label: '今日学习', href: '/', active: pathname === '/' },
    { key: 'progress', label: '学习复盘', href: '/progress', active: active('/progress') },
    { key: 'assistant', label: 'AI 助手', href: '/ask', active: active('/ask') },
    // U-6 已拍板：非图谱页点「外观主题」直接带参数进入图谱并打开主题面板
    { key: 'appearance', label: '外观主题', href: '/graph?panel=theme' },
    { key: 'settings', label: '设置', href: '/settings', active: active('/settings') },
  ];
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  /** 沉浸式页面（图谱）：隐藏全站导航与页脚，主列交给页面自己编排。 */
  const immersive = pathname === '/graph';

  // 全站检索快捷键（UX-35）：/graph 由图谱内搜索接管，避免两个浮层抢 Ctrl+K
  useEffect(() => {
    if (pathname.startsWith('/graph') || pathname === '/login') return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 中文输入法组合态不劫持按键
      if (event.isComposing) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      // 输入框内也放行：Ctrl/Cmd+K 是全局检索入口，不写入输入内容，符合常见产品惯例
      event.preventDefault();
      setSwitcherOpen((open) => !open);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pathname]);

  if (pathname === '/login') return <>{children}</>;

  const items = buildNavItems(pathname);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div
      className={
        immersive
          ? 'min-h-screen bg-app'
          : 'min-h-screen bg-app pt-safe pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]'
      }
    >
      {!immersive && <GraphNavigation items={items} onLogout={logout} compactOnMobile />}
      <div className={immersive ? 'h-[100dvh] overflow-hidden' : 'flex min-h-screen flex-col'}>
        <main className={immersive ? 'h-full' : 'flex-1 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-3 md:py-6 md:pl-24 md:pr-6'}>{children}</main>
        {!immersive && (
          <footer className="border-t border-line pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 text-center text-tag text-faint md:pb-3 md:pl-24">
            {/* 移动端可见的检索入口：桌面用快捷键即可，这里统一提供触控路径（≥44px） */}
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label="全库检索（Ctrl K）"
              aria-keyshortcuts="Control+K Meta+K"
              className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-tag text-muted transition-colors duration-150 hover:border-line-strong hover:text-primary"
            >
              全库检索
              <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[0.65rem] text-faint md:inline">Ctrl K</kbd>
            </button>
            <p>知识宇宙 · Neon + Cloudflare R2 + Vercel</p>
          </footer>
        )}
      </div>
      {!immersive && switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
    </div>
  );
}
