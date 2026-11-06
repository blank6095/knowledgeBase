'use client';

/**
 * 图谱页的页面级浮层编排（详情面板 / 顶栏与搜索 / 悬浮导航 / 上下文菜单 / AI 关联解释）。
 *
 * 从 KnowledgeUniverse 抽出：这些浮层的共同点是「悬浮在画布之上、只消费上层状态、
 * 不参与布局计算」，与画布渲染、图谱数据加载、筛选偏好等关注点正交。
 * 抽成纯展示组件后，容器不再混杂十余个 props 的 JSX 拼装。
 *
 * 行为与抽取前完全一致：所有回调都由容器传入，浮层只负责渲染与转发。
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AiOverlay from '@/components/AiOverlay';
import type { ConnectData } from '@/lib/graph/graph-state';
import GraphContextMenu, { type GraphContextMenuAction } from './GraphContextMenu';
import GraphNavigation, { type GraphNavItem } from './GraphNavigation';
import GraphSearch, { type GraphSearchHitView } from './GraphSearch';
import GraphTopBar from './GraphTopBar';

/** 节点右键/长按菜单的定位信息 */
export interface GraphContextMenuState {
  node: { id: string; title: string };
  x: number;
  y: number;
}

export interface GraphOverlaysProps {
  /** 顶栏与搜索 */
  nodeCount: number;
  edgeCount: number;
  fixture: string | null;
  searchOpen: boolean;
  searchQuery: string;
  searchResults: GraphSearchHitView[];
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchSelect: (id: string) => void;
  onSearchClear: () => void;

  /** 悬浮导航 */
  navItems: GraphNavItem[];
  onLogout: () => void;

  /** 右键/长按菜单 */
  contextMenu: GraphContextMenuState | null;
  contextMenuActions: GraphContextMenuAction[];
  onContextMenuClose: () => void;

  /** AI 关联解释浮层 */
  connectData: ConnectData | null;
  onConnectClose: () => void;
}

export default function GraphOverlays(props: GraphOverlaysProps) {
  const {
    nodeCount,
    edgeCount,
    fixture,
    searchOpen,
    searchQuery,
    searchResults,
    onSearchOpenChange,
    onSearchQueryChange,
    onSearchSelect,
    onSearchClear,
    navItems,
    onLogout,
    contextMenu,
    contextMenuActions,
    onContextMenuClose,
    connectData,
    onConnectClose,
  } = props;

  return (
    <>
      {/* 顶栏与悬浮导航在加载/空态也保留，避免沉浸模式下无可达入口 */}
      <GraphTopBar
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        fixture={fixture}
        searchOpen={searchOpen}
        searchOverlay={
          <GraphSearch
            open={searchOpen}
            query={searchQuery}
            results={searchResults}
            total={nodeCount}
            onOpenChange={onSearchOpenChange}
            onQueryChange={onSearchQueryChange}
            onSelect={onSearchSelect}
            onClear={onSearchClear}
          />
        }
        onSearchClick={() => onSearchOpenChange(true)}
      />
      {/* UX-01：移动端紧凑导航（3 个核心入口 + 更多），避免一行塞 7+1 个触控目标 */}
      <GraphNavigation items={navItems} onLogout={onLogout} compactOnMobile />
      {contextMenu && (
        <GraphContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.node.title}
          actions={contextMenuActions}
          onClose={onContextMenuClose}
        />
      )}

      {connectData && (
        <AiOverlay
          title="两个概念如何联系"
          subtitle={connectData.segments.map((segment) => segment.title).join(' ↔ ')}
          onClose={onConnectClose}
          footer={
            <button
              onClick={onConnectClose}
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-minor text-muted hover:bg-surface-hover hover:text-primary"
            >
              关闭
            </button>
          }
        >
          <div className="md-body text-body">
            <Markdown remarkPlugins={[remarkGfm]}>{connectData.explanation}</Markdown>
          </div>
        </AiOverlay>
      )}
    </>
  );
}
