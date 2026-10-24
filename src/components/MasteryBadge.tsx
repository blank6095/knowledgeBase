import type { SegmentStatus } from '@/lib/sm2';

export const STATUS_META: Record<SegmentStatus, { label: string; chip: string; dot: string }> = {
  new: { label: '未学习', chip: 'bg-slate-100 text-slate-600', dot: '#94a3b8' },
  learning: { label: '学习中', chip: 'bg-red-100 text-red-700', dot: '#ef4444' },
  familiar: { label: '较熟悉', chip: 'bg-amber-100 text-amber-700', dot: '#f59e0b' },
  mastered: { label: '已掌握', chip: 'bg-emerald-100 text-emerald-700', dot: '#22c55e' },
};

/** 掌握度 → 图谱节点颜色：未学习灰色，其余红→绿渐变 */
export function masteryColor(status: string, mastery: number): string {
  if (status === 'new') return '#94a3b8';
  const hue = Math.round(Math.min(1, Math.max(0, mastery)) * 142);
  return `hsl(${hue}, 70%, 45%)`;
}

export default function MasteryBadge({ status, mastery }: { status: string; mastery: number }) {
  const meta = STATUS_META[(status as SegmentStatus) ?? 'new'] ?? STATUS_META.new;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      {meta.label}
      {status !== 'new' && <span className="opacity-70">{Math.round(mastery * 100)}%</span>}
    </span>
  );
}
