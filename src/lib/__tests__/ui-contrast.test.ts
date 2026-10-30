import { describe, expect, it } from 'vitest';
import {
  AA_NORMAL,
  bestContrastForeground,
  compositeOver,
  contrastRatio,
  hexToRgb,
  meetsAA,
  relativeLuminance,
  rgbToHex,
} from '@/lib/ui/contrast';

describe('hexToRgb / rgbToHex', () => {
  it('解析 6 位与 3 位十六进制', () => {
    expect(hexToRgb('#ece6da')).toEqual({ r: 236, g: 230, b: 218 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('ece6da')).toEqual({ r: 236, g: 230, b: 218 });
  });

  it('非法色值抛错（不静默当成黑色）', () => {
    expect(() => hexToRgb('#12345')).toThrow(/非法十六进制颜色/);
    expect(() => hexToRgb('rgb(1,2,3)')).toThrow(/非法十六进制颜色/);
    expect(() => hexToRgb('')).toThrow(/非法十六进制颜色/);
  });

  it('回写为小写 6 位形式', () => {
    expect(rgbToHex({ r: 236, g: 230, b: 218 })).toBe('#ece6da');
    expect(rgbToHex({ r: 300, g: -5, b: 0 })).toBe('#ff0000');
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('黑白对比度为 21，同色为 1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1b1815', '#1b1815')).toBeCloseTo(1, 5);
  });

  it('相对亮度：黑 0、白 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('对比度与参数顺序无关', () => {
    expect(contrastRatio('#948b7d', '#1b1815')).toBeCloseTo(contrastRatio('#1b1815', '#948b7d'), 10);
  });
});

describe('compositeOver', () => {
  it('alpha=0 时等于底色，alpha=1 时等于覆盖色', () => {
    expect(compositeOver('#000000', '#ffffff', 0)).toBe('#000000');
    expect(compositeOver('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('中间值按比例混合', () => {
    expect(compositeOver('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('alpha 越界时被夹紧', () => {
    expect(compositeOver('#000000', '#ffffff', -1)).toBe('#000000');
    expect(compositeOver('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});

describe('bestContrastForeground / meetsAA', () => {
  it('亮底选深色字、暗底选浅色字', () => {
    const candidates = ['#201708', '#ece6da'];
    expect(bestContrastForeground('#af853c', candidates)).toBe('#201708');
    expect(bestContrastForeground('#1b1815', candidates)).toBe('#ece6da');
  });

  it('候选为空时抛错', () => {
    expect(() => bestContrastForeground('#000000', [])).toThrow(/候选前景色不能为空/);
  });

  it('meetsAA 按字号使用不同阈值', () => {
    // #6e675c 对卡片底约 3.16:1 —— 只满足大字号阈值
    expect(meetsAA('#1b1815', '#6e675c')).toBe(false);
    expect(meetsAA('#1b1815', '#6e675c', true)).toBe(true);
    expect(meetsAA('#1b1815', '#948b7d')).toBe(true);
    expect(AA_NORMAL).toBe(4.5);
  });
});
