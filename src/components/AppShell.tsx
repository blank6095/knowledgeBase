'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

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
        className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
          showLabel ? '' : 'justify-center'
        } ${active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-hover hover:text-primary'}`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {showLabel && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* 移动端抽屉遮罩 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* 侧边栏：桌面常驻（可折叠成图标栏），<768px 抽屉 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-all duration-200 md:sticky md:z-20 md:h-screen md:translate-x-0 md:inset-y-auto ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-12' : 'md:w-60'}`}
      >
        <div className={`flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
          <span className="text-base leading-none">🧠</span>
          <span className={`truncate text-sm font-semibold ${collapsed ? 'md:hidden' : ''}`}>个人知识库</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">{NAV.map((item) => navItem(item))}</nav>

        <div className="space-y-0.5 border-t border-line p-2">
          <button
            onClick={logout}
            title={collapsed ? '退出' : undefined}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-danger ${
              collapsed ? 'md:justify-center md:px-0' : ''
            }`}
          >
            <IcLogout className="h-4 w-4 shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>退出</span>
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`hidden w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-primary md:flex ${
              collapsed ? 'justify-center px-0' : ''
            }`}
            aria-label="折叠侧边栏"
          >
            <IcChevron className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
            <span className={collapsed ? 'hidden' : ''}>收起</span>
          </button>
        </div>
      </aside>

      {/* 主列：全幅（图谱需要），阅读类页面自行限宽 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-line bg-app/95 px-3 backdrop-blur md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-primary"
          >
            <IcMenu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">🧠 个人知识库</span>
        </header>
        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
        <footer className="border-t border-line py-3 text-center text-[11px] text-muted">
          个人知识库 · Neon + Cloudflare R2 + Vercel
        </footer>
      </div>
    </div>
  );
}
