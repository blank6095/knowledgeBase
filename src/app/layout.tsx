import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSerifSc = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  weight: "600",
  display: "swap",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "知识宇宙",
  description: "跨设备访问、自动关联、打开即学习的个人知识库",
  applicationName: "知识宇宙",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "知识宇宙",
  },
  // 兼容旧版 iOS：Next 默认只输出 mobile-web-app-capable，旧 Safari 需要 apple-* 前缀
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * viewport-fit=cover：让页面铺满刘海屏/圆角屏，安全区由各处的 pt-safe / pb-safe 让出。
 * 不开的话 env(safe-area-inset-*) 恒为 0，底部导航会被 Home Indicator 压住。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a1020",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      data-graph-env="deep-space"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSc.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-app text-primary antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
