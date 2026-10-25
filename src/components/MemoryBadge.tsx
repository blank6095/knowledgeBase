import { MEMORY_TIER_DOTS, memoryTier, type MemoryTier } from '@/lib/memory';

/** 档位元数据：色点为琥珀灯光梯度（定义见 memory.ts MEMORY_TIER_DOTS） */
export const MEMORY_TIER_META: Record<MemoryTier, { label: string; dot: string }> = {
  unread: { label: '未读', dot: MEMORY_TIER_DOTS.unread },
  weak: { label: '弱', dot: MEMORY_TIER_DOTS.weak },
  medium: { label: '中', dot: MEMORY_TIER_DOTS.medium },
  strong: { label: '强', dot: MEMORY_TIER_DOTS.strong },
};

export default function MemoryBadge({ memory }: { memory: number }) {
  const meta = MEMORY_TIER_META[memoryTier(memory)];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-hover px-2 py-0.5 text-tag text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      记忆 <span className="font-mono tabular-nums">{Math.round(memory * 100)}%</span>
    </span>
  );
}
