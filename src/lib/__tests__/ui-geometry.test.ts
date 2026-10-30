import { describe, expect, it } from 'vitest';
import { clampPopover, POPOVER_WIDTH } from '@/lib/ui/geometry';

const VIEWPORT = { viewportWidth: 375, viewportHeight: 812 };

describe('clampPopover 浮层碰撞计算', () => {
  it('空间充足时按锚点居中放在下方', () => {
    const pos = clampPopover({
      anchorX: 180,
      anchorY: 300,
      width: POPOVER_WIDTH,
      height: 200,
      ...VIEWPORT,
    });
    expect(pos.left).toBe(180 - POPOVER_WIDTH / 2);
    expect(pos.top).toBe(308); // 锚点 + 间距 8
    expect(pos.placement).toBe('bottom');
    expect(pos.flipped).toBe(false);
    expect(pos.clampedX).toBe(false);
  });

  it('窄屏下浮层不会越出左右边界', () => {
    const pos = clampPopover({
      anchorX: 10,
      anchorY: 300,
      width: POPOVER_WIDTH,
      height: 200,
      ...VIEWPORT,
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + POPOVER_WIDTH).toBeLessThanOrEqual(375 - 8);
    expect(pos.clampedX).toBe(true);
  });

  it('贴右边缘同样不会越界', () => {
    const pos = clampPopover({
      anchorX: 370,
      anchorY: 300,
      width: POPOVER_WIDTH,
      height: 200,
      ...VIEWPORT,
    });
    expect(pos.left + POPOVER_WIDTH).toBeLessThanOrEqual(375 - 8);
  });

  it('下方空间不足且上方足够时翻到上方', () => {
    const pos = clampPopover({
      anchorX: 180,
      anchorY: 700,
      width: POPOVER_WIDTH,
      height: 200,
      ...VIEWPORT,
    });
    expect(pos.placement).toBe('top');
    expect(pos.flipped).toBe(true);
    expect(pos.top + 200).toBeLessThanOrEqual(700);
  });

  it('上下都不足时贴到可用区域顶部且不越界', () => {
    const pos = clampPopover({
      anchorX: 180,
      anchorY: 400,
      width: POPOVER_WIDTH,
      height: 900, // 比视口还高
      ...VIEWPORT,
    });
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top).toBeLessThanOrEqual(812 - 8);
  });

  it('浮层比视口窄时宽度按可用空间收敛', () => {
    const pos = clampPopover({
      anchorX: 180,
      anchorY: 300,
      width: 999,
      height: 100,
      ...VIEWPORT,
    });
    expect(pos.left).toBe(8);
    expect(pos.left + 999).toBeGreaterThan(375); // 宽度由 CSS max-width 兜底，位置仍贴边
  });

  it('退化输入（0 尺寸视口）不抛错', () => {
    const pos = clampPopover({
      anchorX: 0,
      anchorY: 0,
      width: 0,
      height: 0,
      viewportWidth: 0,
      viewportHeight: 0,
    });
    expect(Number.isFinite(pos.left)).toBe(true);
    expect(Number.isFinite(pos.top)).toBe(true);
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });

  it('margin 可配置', () => {
    const pos = clampPopover({
      anchorX: 5,
      anchorY: 300,
      width: POPOVER_WIDTH,
      height: 100,
      margin: 20,
      ...VIEWPORT,
    });
    expect(pos.left).toBe(20);
  });
});
