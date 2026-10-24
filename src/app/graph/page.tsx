'use client';

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { masteryColor, STATUS_META } from '@/components/MasteryBadge';
import type { SegmentStatus } from '@/lib/sm2';

// 力导向图依赖 window，仅浏览器渲染
const Graph = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as unknown as React.ComponentType<{
  graphData: unknown;
  nodeColor?: (n: never) => string;
  nodeVal?: (n: never) => number;
  nodeLabel?: (n: never) => string;
  linkColor?: (l: never) => string;
  linkWidth?: (l: never) => number;
  onNodeClick?: (n: never) => void;
  width?: number;
  height?: number;
  backgroundColor?: string;
}>;

interface GNode {
  id: string;
  title: string;
  mastery: number;
  status: string;
  viewCount: number;
  dueAt: string;
  documentTitle: string | null;
}
interface GLink {
  source: string;
  target: string;
  kind: string;
  weight: number;
}

const STATUS_ORDER: SegmentStatus[] = ['new', 'learning', 'familiar', 'mastered'];
const KINDS = [
  { kind: 'wiki', label: '双链', color: '#6366f1' },
  { kind: 'tag', label: '标签', color: '#94a3b8' },
  { kind: 'doc', label: '同文档', color: '#e2e8f0' },
];

export default function GraphPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<GNode[] | null>(null);
  const [links, setLinks] = useState<GLink[]>([]);
  const [error, setError] = useState('');
  // 压测模式：?fixture=<name> 加载 /fixtures/<name>.json（由 scripts/gen-graph-data.mjs 生成）
  const [fixture] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fixture') : null,
  );
  const [statusOn, setStatusOn] = useState<Record<string, boolean>>(
    Object.fromEntries(STATUS_ORDER.map((s) => [s, true])),
  );
  const [kindOn, setKindOn] = useState<Record<string, boolean>>(
    Object.fromEntries(KINDS.map((k) => [k.kind, true])),
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  useEffect(() => {
    api<{ nodes: GNode[]; edges: GLink[] }>(fixture ? `/fixtures/${fixture}.json` : '/api/graph')
      .then((d) => {
        setNodes(d.nodes);
        setLinks(d.edges);
      })
      .catch((e) => setError(e.message));
  }, [fixture]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes]);

  const graphData = useMemo(() => {
    if (!nodes) return { nodes: [], links: [] };
    const visible = nodes.filter((n) => statusOn[n.status] ?? false);
    const visIds = new Set(visible.map((n) => n.id));
    const degree = new Map<string, number>();
    const visLinks = links.filter((l) => {
      if (!(kindOn[l.kind] ?? false)) return false;
      if (!visIds.has(l.source) || !visIds.has(l.target)) return false;
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
      return true;
    });
    // force-graph 会原地替换 source/target 为对象引用，传浅拷贝避免污染状态
    return {
      nodes: visible.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
      links: visLinks.map((l) => ({ ...l })),
    };
  }, [nodes, links, statusOn, kindOn]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!nodes) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">知识网络</h1>
        {fixture && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            压测数据模式：{fixture}（{nodes?.length ?? 0} 节点）
          </span>
        )}
        <div className="flex-1" />
        {/* 掌握度图例 */}
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="text-slate-400">掌握度</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full" style={{ background: '#ef4444' }} />低</span>
          <span className="h-2.5 w-16 rounded-full" style={{ background: 'linear-gradient(to right, #ef4444, #f59e0b, #22c55e)' }} />
          <span className="flex items-center gap-1">高<i className="ml-0 h-2.5 w-2.5 rounded-full" style={{ background: '#22c55e' }} /></span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-slate-400" />未学习</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">状态</span>
          {STATUS_ORDER.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={statusOn[s] ?? false}
                onChange={(e) => setStatusOn((prev) => ({ ...prev, [s]: e.target.checked }))}
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[s].dot }} />
              {STATUS_META[s].label}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">关联</span>
          {KINDS.map((k) => (
            <label key={k.kind} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={kindOn[k.kind] ?? false}
                onChange={(e) => setKindOn((prev) => ({ ...prev, [k.kind]: e.target.checked }))}
              />
              <span className="h-0.5 w-4 rounded" style={{ background: k.color }} />
              {k.label}
            </label>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">节点大小 = 关联数 · 点击节点查看知识点</span>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          还没有知识点，先去 <Link href="/import" className="text-blue-600 underline">导入</Link> 一篇笔记吧。
        </div>
      ) : (
        <div ref={wrapRef} className="h-[65vh] overflow-hidden rounded-xl border border-slate-200 bg-white">
          <Graph
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="#ffffff"
            nodeColor={(n) => masteryColor((n as unknown as GNode).status, (n as unknown as GNode).mastery)}
            nodeVal={(n) => 2 + Math.min(5, (n as unknown as { degree: number }).degree)}
            nodeLabel={(n) => {
              const d = n as unknown as GNode;
              return `<div style="max-width:280px;font:13px sans-serif;padding:4px">
                <b>${d.title}</b><br/>
                <span style="color:#64748b">${d.documentTitle ?? ''}</span><br/>
                掌握 ${Math.round(d.mastery * 100)}% · 查看 ${d.viewCount} 次
              </div>`;
            }}
            linkColor={(l) => KINDS.find((k) => k.kind === (l as unknown as GLink).kind)?.color ?? '#cbd5e1'}
            linkWidth={(l) => Math.max(0.5, (l as unknown as GLink).weight)}
            onNodeClick={(n) => router.push(`/segments/${(n as unknown as GNode).id}`)}
          />
        </div>
      )}
    </div>
  );
}
