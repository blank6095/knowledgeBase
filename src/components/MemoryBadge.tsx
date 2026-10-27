/**
 * 全站掌握度编码规范：
 * 1. 凡是列表、徽章、统计分布，一律按 MEMORY_TIER_META 的四档点色呈现
 *    （unread/weak/medium/strong → MEMORY_TIER_DOTS），同一档位在任何页面颜色一致；
 * 2. memoryColor 的连续亮度渐变只允许用于图谱节点与图谱图例（亮度本身即掌握度）；
 * 3. 新增展示位不得再按连续记忆度取色，避免同一段落在不同页面出现两种「灯光」。
 */
import { MEMORY_TIER_DOTS, MEMORY_TIER_LABELS, memoryTier, type MemoryTier } from '@/lib/memory';

/** 档位元数据：色点为琥珀灯光梯度（定义见 memory.ts MEMORY_TIER_DOTS），label 为灯光隐喻名 */
export const MEMORY_TIER_META: Record<MemoryTier, { label: string; dot: string }> = {
  unread: { label: MEMORY_TIER_LABELS.unread, dot: MEMORY_TIER_DOTS.unread },
  weak: { label: MEMORY_TIER_LABELS.weak, dot: MEMORY_TIER_DOTS.weak },
  medium: { label: MEMORY_TIER_LABELS.medium, dot: MEMORY_TIER_DOTS.medium },
  strong: { label: MEMORY_TIER_LABELS.strong, dot: MEMORY_TIER_DOTS.strong },
};

/** 裸灯点：色=档位点色 + 微光晕。带 title 时可访问（role=img），否则纯装饰 */
export function LampDot({ memory, title }: { memory: number; title?: string }) {
  const color = MEMORY_TIER_DOTS[memoryTier(memory)];
  const dot = <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px 1px ${color}` }} />;
  if (!title) return <span aria-hidden className="inline-flex shrink-0">{dot}</span>;
  return (
    <span role="img" aria-label={`记忆程度：${title}`} title={title} className="inline-flex shrink-0">
      {dot}
    </span>
  );
}

/** 记忆灯点：纯视觉（色=档位点色），hover 文案为档位名，无模型派生数字 */
export default function MemoryBadge({ memory }: { memory: number }) {
  return <LampDot memory={memory} title={MEMORY_TIER_LABELS[memoryTier(memory)]} />;
}
