import { MEMORY_TIER_DOTS, MEMORY_TIER_LABELS, memoryColor, memoryTier, type MemoryTier } from '@/lib/memory';

/** 档位元数据：色点为琥珀灯光梯度（定义见 memory.ts MEMORY_TIER_DOTS），label 为灯光隐喻名 */
export const MEMORY_TIER_META: Record<MemoryTier, { label: string; dot: string }> = {
  unread: { label: MEMORY_TIER_LABELS.unread, dot: MEMORY_TIER_DOTS.unread },
  weak: { label: MEMORY_TIER_LABELS.weak, dot: MEMORY_TIER_DOTS.weak },
  medium: { label: MEMORY_TIER_LABELS.medium, dot: MEMORY_TIER_DOTS.medium },
  strong: { label: MEMORY_TIER_LABELS.strong, dot: MEMORY_TIER_DOTS.strong },
};

/** 裸灯点：亮度=记忆度 + 微光晕。带 title 时可访问（role=img），否则纯装饰 */
export function LampDot({ memory, title }: { memory: number; title?: string }) {
  const color = memoryColor(memory);
  const dot = <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px 1px ${color}` }} />;
  if (!title) return <span aria-hidden className="inline-flex shrink-0">{dot}</span>;
  return (
    <span role="img" aria-label={`记忆程度：${title}`} title={title} className="inline-flex shrink-0">
      {dot}
    </span>
  );
}

/** 记忆灯点：纯视觉（亮度=记忆度），hover 文案为档位名，无模型派生数字 */
export default function MemoryBadge({ memory }: { memory: number }) {
  return <LampDot memory={memory} title={MEMORY_TIER_LABELS[memoryTier(memory)]} />;
}
