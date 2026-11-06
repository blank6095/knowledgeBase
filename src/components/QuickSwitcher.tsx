'use client';

/**
 * 全局快速检索（P0 · 全站 Ctrl/Cmd+K，UX-35）。
 *
 * 复用图谱的索引与评分（src/lib/graph/graph-search.ts）：标题精确 > 前缀 > 包含 >
 * 标签 > 标题路径 > 摘要，结果按分数排序；Enter 跳转到对应知识点详情。
 *
 * 接线方式：由 AppShell 负责快捷键与页脚入口，`/graph` 不挂载本组件（图谱内搜索接管）；
 * 打开时才挂载，关闭（Esc / 遮罩 / 再次 Ctrl+K）后卸载并把焦点还原到触发元素（UX-16）。
 * 索引在模块级缓存一次，避免每次打开都重新拉 /api/graph（失败不缓存，下次重试）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { useFocusTrap } from '@/lib/ui/focus-trap';
import {
  buildSearchIndex,
  reasonLabel,
  searchGraph,
  type GraphSearchIndex,
  type SearchHit,
} from '@/lib/graph/graph-search';
import type { GraphNode } from '@/lib/graph/graph-types';

/** 模块级索引缓存：同一标签页内多次打开不重复请求；失败不写缓存 */
let cachedNodes: GraphNode[] | null = null;

export default function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [nodes, setNodes] = useState<GraphNode[] | null>(cachedNodes);
  const [failed, setFailed] = useState(false);

  // 焦点陷阱：打开即聚焦搜索框，Tab 停留在浮层内，Esc 关闭后焦点回到入口按钮
  useFocusTrap({ active: true, containerRef: panelRef, onEscape: onClose });

  // 懒加载索引：setState 全部发生在 await 之后，避免 effect 内同步级联渲染
  useEffect(() => {
    if (cachedNodes) return;
    let alive = true;
    (async () => {
      try {
        const data = await api<{ nodes: GraphNode[] }>('/api/graph');
        if (!alive) return;
        cachedNodes = data.nodes;
        setNodes(data.nodes);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const index: GraphSearchIndex | null = useMemo(() => (nodes ? buildSearchIndex(nodes) : null), [nodes]);
  const result = useMemo(
    () => (index && query.trim() ? searchGraph(index, query, 10) : null),
    [index, query],
  );
  const hits = result?.hits ?? [];

  const jump = (hit: SearchHit) => {
    onClose();
    router.push(`/segments/${hit.id}`);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && hits.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp' && hits.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && hits[activeIndex]) {
      event.preventDefault();
      jump(hits[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="全局检索"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/55" />
      <div
        ref={panelRef}
        className="relative mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="搜索知识点：标题 / 标签 / 路径 / 摘要"
          aria-label="搜索知识点"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-body text-primary outline-none placeholder:text-faint"
        />

        {query.trim() === '' ? (
          <p className="px-4 py-6 text-tag text-faint">输入关键词开始检索；↑↓ 选择，Enter 打开，Esc 关闭。</p>
        ) : failed ? (
          <p className="px-4 py-6 text-tag text-danger">索引加载失败，请稍后重试。</p>
        ) : nodes === null ? (
          <p className="px-4 py-6 text-tag text-faint">索引加载中…</p>
        ) : hits.length === 0 ? (
          <p className="px-4 py-6 text-tag text-faint">没有匹配的知识点。</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox" aria-label="检索结果">
            {hits.map((hit, i) => {
              const node = nodes.find((item) => item.id === hit.id);
              return (
                <li key={hit.id} role="option" aria-selected={i === activeIndex} onMouseEnter={() => setActiveIndex(i)}>
                  <button
                    type="button"
                    onClick={() => jump(hit)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                      i === activeIndex ? 'bg-accent/10 text-accent-strong' : 'text-muted hover:bg-surface-hover'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body">{hit.title}</span>
                      <span className="mt-0.5 block truncate text-tag text-faint">
                        {node?.documentTitle ?? '未归入文档'}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-tag text-faint">
                      {reasonLabel(hit.reason)}
                      {hit.detail ? ` · ${hit.detail}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
