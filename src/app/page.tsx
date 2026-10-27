'use client';

/**
 * 概览页入口：只负责挂载行动面板。
 * 面板实现、信息层级与掌握度编码规范见 src/components/DashboardPanel.tsx。
 */
import DashboardPanel from '@/components/DashboardPanel';

export default function DashboardPage() {
  return <DashboardPanel />;
}
