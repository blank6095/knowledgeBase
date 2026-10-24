'use client';

import { review, type Grade } from '@/lib/sm2';

const GRADES: { g: Grade; label: string; cls: string }[] = [
  { g: 0, label: '忘记', cls: 'bg-red-600 hover:bg-red-500' },
  { g: 1, label: '困难', cls: 'bg-orange-500 hover:bg-orange-400' },
  { g: 2, label: '良好', cls: 'bg-blue-600 hover:bg-blue-500' },
  { g: 3, label: '简单', cls: 'bg-emerald-600 hover:bg-emerald-500' },
];

function hint(intervalDays: number, grade: Grade): string {
  if (grade === 0) return '10 分钟后重现';
  if (intervalDays < 1) return '明天';
  return `${intervalDays} 天后`;
}

export default function GradeButtons({
  state,
  disabled,
  onGrade,
}: {
  state: { ease: number; intervalDays: number; reps: number; lapses: number };
  disabled?: boolean;
  onGrade: (grade: Grade) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GRADES.map(({ g, label, cls }) => {
        const next = review(state, g);
        return (
          <button
            key={g}
            disabled={disabled}
            onClick={() => onGrade(g)}
            className={`rounded-lg py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${cls}`}
          >
            {label}
            <span className="block text-[11px] font-normal opacity-80">{hint(next.intervalDays, g)}</span>
          </button>
        );
      })}
    </div>
  );
}
