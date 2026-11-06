import { describe, expect, it } from 'vitest';
import { buildNavItems } from '@/components/AppShell';
import { isCompactBarItem, MOBILE_CORE_KEYS } from '@/components/graph/GraphNavigation';

describe('全站导航（UX-01 / U-6）', () => {
  it('移动端紧凑模式只留 3 个核心入口，其余收进「更多」抽屉', () => {
    const items = buildNavItems('/notes');
    const visible = items.filter((item) => isCompactBarItem(item.key, true));
    expect(visible.map((item) => item.key)).toEqual(['universe', 'library', 'assistant']);
    // 底部条 = 3 个核心 +（紧凑模式专属的）「更多」，共 4 个触控目标；
    // 320px 下减去左右安全区与内边距后每个约 70px，满足 ≥44px 的验收线。
    expect(visible.length + 1).toBe(4);
  });

  it('桌面左栏（非紧凑）保留全部入口，不因紧凑模式删项', () => {
    const items = buildNavItems('/notes');
    expect(items).toHaveLength(7);
    expect(items.every((item) => isCompactBarItem(item.key, false))).toBe(true);
  });

  it('「外观主题」带参数进入图谱主题面板，且不抢占「知识宇宙」高亮', () => {
    const appearance = buildNavItems('/notes').find((item) => item.key === 'appearance');
    expect(appearance?.href).toBe('/graph?panel=theme');
    expect(appearance?.active).toBeUndefined();
  });

  it('当前页高亮按 pathname 精确/前缀推导', () => {
    expect(buildNavItems('/notes/abc').find((item) => item.key === 'library')?.active).toBe(true);
    expect(buildNavItems('/').find((item) => item.key === 'today')?.active).toBe(true);
    expect(buildNavItems('/progress').find((item) => item.key === 'settings')?.active).toBe(false);
  });

  it('核心入口 key 与底部条顺序一致', () => {
    expect(MOBILE_CORE_KEYS).toEqual(['universe', 'library', 'assistant']);
  });
});
