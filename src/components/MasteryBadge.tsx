import type { SegmentStatus } from '@/lib/sm2';

export const STATUS_META: Record<SegmentStatus, { label: string; chip: string; dot: string }> = {
  new: { label: '未学习', chip: 'bg-neutral/10 text-neutral', dot: '#9ca3af' },
  learning: { label: '学习中', chip: 'bg-danger/10 text-danger', dot: '#f87171' },
  familiar: { label: '较熟悉', chip: 'bg-warn/10 text-warn', dot: '#fbbf24' },
  mastered: { label: '已掌握', chip: 'bg-success/10 text-success', dot: '#4ade80' },
};

/** 掌握度 → 图谱节点颜色：未学习灰色，其余红→绿渐变（深底亮度 55% 保证可辨） */
export function masteryColor(status: string, mastery: number): string {
  if (status === 'new') return '#9ca3af';
  const hue = Math.round(Math.min(1, Math.max(0, mastery)) * 142);
  return `hsl(${hue}, 70%, 55%)`;
}

export default function MasteryBadge({ status, mastery }: { status: string; mastery: number }) {
  const meta = STATUS_META[(status as SegmentStatus) ?? 'new'] ?? STATUS_META.new;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      {meta.label}
      {status !== 'new' && <span className="opacity-70">{Math.round(mastery * 100)}%</span>}
    </span>
  );
}
