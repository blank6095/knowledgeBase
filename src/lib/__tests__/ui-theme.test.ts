import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA } from '@/lib/ui/contrast';
import { LIGHT_BACKGROUND_FOREGROUNDS, PALETTE, SURFACE_BACKGROUNDS } from '@/lib/ui/theme';

/**
 * 主题对比度审计：把「小字能不能看清」变成可回归的单测。
 * 若有人调暗 --color-faint，这里会立刻失败，而不是等到肉眼发现。
 */
describe('主题色对比度审计', () => {
  it('弱文字（faint）在三种底色上都达到 AA 4.5:1', () => {
    for (const bg of SURFACE_BACKGROUNDS) {
      expect({ bg, ratio: contrastRatio(bg, PALETTE.faint) }).toMatchObject({ ratio: expect.any(Number) });
      expect(meetsAA(bg, PALETTE.faint)).toBe(true);
    }
  });

  it('次要文字（muted）与正文（primary）同样满足 AA', () => {
    for (const bg of SURFACE_BACKGROUNDS) {
      expect(meetsAA(bg, PALETTE.muted)).toBe(true);
      expect(meetsAA(bg, PALETTE.primary)).toBe(true);
    }
  });

  it('琥珀底上的文字（accent-ink）满足 AA', () => {
    expect(meetsAA(PALETTE.accent, PALETTE.accentInk)).toBe(true);
    expect(meetsAA(PALETTE.accentStrong, PALETTE.accentInk)).toBe(true);
  });

  it('亮底前景候选中至少有一个满足 AA（热力图用）', () => {
    const bright = '#af853c';
    expect(LIGHT_BACKGROUND_FOREGROUNDS.some((fg) => meetsAA(bright, fg))).toBe(true);
  });

  it('装饰弱色仅用于装饰，不要求达标', () => {
    // faint-decor 保留原视觉重量，仅允许出现在序号/分隔线等位置
    expect(contrastRatio(PALETTE.surface, PALETTE.faintDecor)).toBeLessThan(4.5);
  });
});
