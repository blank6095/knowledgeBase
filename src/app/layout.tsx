import type { Metadata } from "next";
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
  title: "个人知识库",
  description: "跨设备访问、自动关联、打开即学习的个人知识库",
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
