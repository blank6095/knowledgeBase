import { memoryColor, memoryTier, type MemoryTier } from '@/lib/memory';

/** 档位元数据：色点取各档代表性记忆度的记忆色，与图谱渐变同族 */
export const MEMORY_TIER_META: Record<MemoryTier, { label: string; dot: string }> = {
  unread: { label: '未读', dot: memoryColor(0) },
  weak: { label: '弱', dot: memoryColor(0.2) },
  medium: { label: '中', dot: memoryColor(0.55) },
  strong: { label: '强', dot: memoryColor(0.9) },
};

export default function MemoryBadge({ memory }: { memory: number }) {
  const meta = MEMORY_TIER_META[memoryTier(memory)];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      记忆 {Math.round(memory * 100)}%
    </span>
  );
}
