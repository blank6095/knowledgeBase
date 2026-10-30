'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

/** 四芒灯火 mark：暗夜书房的灯（accent 色，由使用处的 text-accent 决定） */
const LogoMark = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M12 2.2c.78 5.02 4.58 8.82 9.8 9.8-5.22.98-9.02 4.78-9.8 9.8-.78-5.02-4.58-8.82-9.8-9.8 5.22-.98 9.02-4.78 9.8-9.8Z"
      fill="currentColor"
    />
  </svg>
);
const IcOverview = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.8V21h14V9.8" />
  </svg>
);
const IcLibrary = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);
const IcGraph = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="5" cy="5" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M7 5h10M6.6 6.5l4.2 10.8M17.4 6.5l-4.2 10.8" />
  </svg>
);
const IcAsk = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.6-.28-3.7-.8L3 21l1.3-5.8A8.5 8.5 0 1 1 21 12Z" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.6c0 1.6-2.4 1.9-2.4 3.3" />
    <circle cx="12" cy="16.2" r="0.2" fill="currentColor" />
  </svg>
);
const IcProgress = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
const IcSettings = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </svg>
);
const IcLogout = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);
const IcChevron = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const IcMenu = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const NAV = [
  { href: '/', label: '概览', icon: IcOverview },
  { href: '/notes', label: '知识库', icon: IcLibrary },
  { href: '/graph', label: '关系图谱', icon: IcGraph },
  { href: '/progress', label: '学习复盘', icon: IcProgress },
  { href: '/ask', label: '助手', icon: IcAsk },
] as const;

/**
 * 外壳只做 Suspense 边界：usePathname/useRouter 属于运行时 URL 数据，
 * 包在 Suspense 内才不阻塞 cacheComponents 模式下的静态预渲染。
 */
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
  const [collapsed, setCollapsed] = useState(false); // 桌面端折叠为图标栏
  const [drawerOpen, setDrawerOpen] = useState(false); // 移动端抽屉

  if (pathname === '/login') return <>{children}</>;

  /** 沉浸式页面（图谱）：隐藏全站侧边栏/移动端 header/footer，主列交给页面自己编排。 */
  const immersive = pathname === '/graph';

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const navItem = (item: (typeof NAV)[number], mobile = false) => {
    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    const showLabel = mobile || !collapsed;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={showLabel ? undefined : item.label}
        onClick={() => setDrawerOpen(false)}
        className={`navlink ${active ? 'navlink-active' : ''} flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body transition-colors duration-150 ${
          showLabel ? '' : 'justify-center'
        } ${
          active
            ? 'bg-accent/10 text-accent-strong'
            : 'text-muted hover:bg-surface-hover hover:text-primary'
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {showLabel && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <div
      className="flex min-h-screen"
      style={{ '--sidebar-w': collapsed ? '3rem' : '15rem' } as React.CSSProperties}
    >
      {/* 移动端抽屉遮罩 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* 侧边栏：桌面常驻（可折叠成图标栏），<768px 抽屉；md:top-0 使 sticky 真正吸附 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-[transform,width] duration-200 ease-out md:sticky md:top-0 md:z-20 md:h-screen md:translate-x-0 md:inset-y-auto ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-12' : 'md:w-60'} ${immersive ? 'hidden' : ''}`}
      >
        <div className={`flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
          <LogoMark className="h-5 w-5 shrink-0 text-accent" />
          <span className={`truncate font-display text-body font-semibold ${collapsed ? 'md:hidden' : ''}`}>
            暗夜书房
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">{NAV.map((item) => navItem(item))}</nav>

        <div className="space-y-0.5 border-t border-line p-2">
          <Link
            href="/settings"
            title={collapsed ? '设置' : undefined}
            onClick={() => setDrawerOpen(false)}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary ${
              pathname.startsWith('/settings') ? 'text-accent' : ''
            } ${collapsed ? 'md:justify-center md:px-0' : ''}`}
          >
            <IcSettings className="h-4 w-4 shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>设置</span>
          </Link>
          <button
            onClick={logout}
            title={collapsed ? '退出' : undefined}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-danger ${
              collapsed ? 'md:justify-center md:px-0' : ''
            }`}
          >
            <IcLogout className="h-4 w-4 shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>退出</span>
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`hidden w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-primary md:flex ${
              collapsed ? 'justify-center px-0' : ''
            }`}
            aria-label="折叠侧边栏"
          >
            <IcChevron className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
            <span className={collapsed ? 'hidden' : ''}>收起</span>
          </button>
        </div>
      </aside>

      {/* 主列：全幅（图谱需要），阅读类页面自行限宽 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`sticky top-0 z-10 h-12 items-center gap-2 border-b border-line bg-app/90 px-3 backdrop-blur md:hidden ${immersive ? 'hidden' : 'flex'}`}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-primary"
          >
            <IcMenu className="h-5 w-5" />
          </button>
          <LogoMark className="h-4 w-4 text-accent" />
          <span className="font-display text-body font-semibold">暗夜书房</span>
        </header>
        <main className={immersive ? 'relative flex-1 overflow-hidden' : 'flex-1 px-4 py-5 md:px-6 md:py-6'}>{children}</main>
        <footer className={`border-t border-line py-3 text-center text-tag text-faint ${immersive ? 'hidden' : ''}`}>
          暗夜书房 · Neon + Cloudflare R2 + Vercel
        </footer>
      </div>
    </div>
  );
}
