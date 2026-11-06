'use client';

/**
 * 图谱节点详情加载（KnowledgeUniverse 的详情状态机）。
 *
 * 从 KnowledgeUniverse 抽出：详情拉取、缓存命中、请求竞态防护（token）与缓存失效
 * 是一组内聚的行为，抽出后容器只负责「选中哪个节点」与「把结果交给面板」。
 *
 * 行为与抽取前完全一致：
 * - 缓存命中直接展示，不发请求；
 * - 标题先取图谱节点名，详情接口返回前即可显示「打开的是哪个知识点」（FE-009）；
 * - 请求带 token，晚到的旧请求不会覆盖新选择的状态；
 * - 失效（UX-30）在编辑/复习/删除等写操作前调用；若该节点正展示则同步收起。
 */
import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { createDetailCache } from '@/lib/graph/graph-detail-cache';
import type { GraphDetailData, GraphDetailNeighbor } from '@/components/graph/GraphDetailPanel';
import type { SegmentDetailPayload } from '@/lib/contracts';

export interface DetailState {
  status: 'loading' | 'error' | 'ok';
  data: GraphDetailData | null;
  error?: string;
  /**
   * 图谱节点标题：详情接口返回前先用它渲染标题（FE-009）。
   * 否则加载中/加载失败时标题一直停在「加载中…」，用户不知道打开的是哪个节点。
   */
  title?: string;
}

/** 把详情接口的邻居按「出链/入链 → 双链、共同标签 → 标签、上一/下一节 → 同文档」合并去重。 */
export function toDetailData(res: SegmentDetailPayload): GraphDetailData {
  const entries: GraphDetailNeighbor[] = [
    ...res.refs.outgoing.map((item) => ({ ...item, kind: 'wiki' })),
    ...res.refs.incoming.map((item) => ({ ...item, kind: 'wiki' })),
    ...res.refs.relatedTags.map((item) => ({ ...item, kind: 'tag' })),
    ...(res.refs.prev ? [{ ...res.refs.prev, kind: 'doc' }] : []),
    ...(res.refs.next ? [{ ...res.refs.next, kind: 'doc' }] : []),
  ];
  const seen = new Set<string>();
  const neighbors: GraphDetailNeighbor[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    neighbors.push(entry);
  }
  return {
    id: res.segment.id,
    title: res.segment.title,
    documentTitle: res.document?.title ?? null,
    headingPath: res.segment.headingPath,
    memory: res.segment.memory,
    tags: res.segment.tags,
    summary: res.segment.summary,
    neighborCount: neighbors.length,
    neighbors,
  };
}

export interface GraphDetailLoader {
  selectedId: string | null;
  detail: DetailState | null;
  /** 选中节点并拉取详情（缓存命中直接展示；请求带 token 防串号）。 */
  selectNode: (id: string, nodeTitle?: string) => void;
  /** 收起详情面板（同时把焦点层级归零）。 */
  closeDetail: () => void;
  /**
   * 让详情缓存失效（编辑/复习/删除等写操作前调用）。
   * 若该节点正在详情面板展示，同步收起（避免前进/后退恢复组件状态时仍停在旧详情）。
   */
  invalidateDetail: (id: string) => void;
}

/**
 * @param nodeTitleOf 从图谱节点列表取标题（详情接口返回前先显示）
 * @param onFocusReset 选中/收起时把焦点层级归零（容器持有该状态）
 */
export function useGraphDetail(
  nodeTitleOf: (id: string) => string | undefined,
  onFocusReset: () => void,
): GraphDetailLoader {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  /** 请求序号：晚到的旧请求不得覆盖新选择的状态 */
  const detailRequest = useRef(0);
  /** 详情缓存（UX-30）：显式失效 + TTL 兜底 */
  const detailCache = useRef(createDetailCache<GraphDetailData>());

  const closeDetail = useCallback(() => {
    detailRequest.current += 1;
    setSelectedId(null);
    setDetail(null);
    onFocusReset();
  }, [onFocusReset]);

  const selectNode = useCallback(
    (id: string, nodeTitle?: string) => {
      setSelectedId(id);
      onFocusReset();
      const cached = detailCache.current.get(id);
      if (cached) {
        setDetail({ status: 'ok', data: cached });
        return;
      }
      const token = detailRequest.current + 1;
      detailRequest.current = token;
      // 标题先取图谱节点名：详情接口返回前就能显示「打开的是哪个知识点」（FE-009）
      const title = nodeTitle ?? nodeTitleOf(id);
      setDetail({ status: 'loading', data: null, title });
      api<SegmentDetailPayload>(`/api/segments/${id}`)
        .then((res) => {
          const data = toDetailData(res);
          detailCache.current.set(id, data);
          if (detailRequest.current === token) setDetail({ status: 'ok', data });
        })
        .catch((e: unknown) => {
          if (detailRequest.current !== token) return;
          setDetail({
            status: 'error',
            data: null,
            title,
            error: e instanceof Error ? e.message : '详情加载失败',
          });
        });
    },
    [nodeTitleOf, onFocusReset],
  );

  const invalidateDetail = useCallback(
    (id: string) => {
      detailCache.current.invalidate(id);
      if (selectedId === id) closeDetail();
    },
    [selectedId, closeDetail],
  );

  return { selectedId, detail, selectNode, closeDetail, invalidateDetail };
}
