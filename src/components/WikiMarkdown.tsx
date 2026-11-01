'use client';

/**
 * 阅读视图的 Markdown 渲染（支持 `[[双链]]`）。
 *
 * 批注锚点按 `.md-body` 的 textContent 偏移定位，所以内链渲染必须**保持原文文本**：
 * `[[`、`标题|`、`]]` 都用字号 0 的 span 隐藏，textContent 与原始 content 完全一致。
 */
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkWikiLink from '@/lib/remark-wikilink';
import { api } from '@/lib/client';
import { buildWikiIndex, resolveWikiTarget, type WikiIndex } from '@/lib/wikilink';

interface GraphPayloadLike {
  nodes: { id: string; title: string; documentTitle?: string | null }[];
}

/** 全库标题索引（/api/graph 有进程内缓存，页面内只请求一次） */
export function useWikiIndex(): WikiIndex {
  const [index, setIndex] = useState<WikiIndex>(() => new Map());
  useEffect(() => {
    let alive = true;
    api<GraphPayloadLike>('/api/graph')
      .then((data) => {
        if (alive) setIndex(buildWikiIndex(data.nodes));
      })
      .catch(() => {
        /* 索引失败时所有内链按断链展示，不阻塞阅读 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return index;
}

interface WikiMarkdownProps {
  content: string;
  index: WikiIndex;
  /** 当前文档标题：同名知识点优先解析到同文档 */
  documentTitle?: string | null;
  className?: string;
}

export default function WikiMarkdown({ content, index, documentTitle, className }: WikiMarkdownProps) {
  const components = useMemo(
    () => ({
      a({ href, children }: { href?: string; children?: ReactNode }) {
        if (!href || !href.startsWith('wiki:')) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          );
        }

        const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
        const inner = raw.startsWith('[[') && raw.endsWith(']]') ? raw.slice(2, -2) : raw;
        const sep = inner.indexOf('|');
        const titleRaw = sep >= 0 ? inner.slice(0, sep) : inner;
        const aliasRaw = sep >= 0 ? inner.slice(sep + 1) : '';
        const title = titleRaw.trim();
        const resolution = resolveWikiTarget(index, title, documentTitle);

        // 括号与「标题|」用字号 0 隐藏，保证 textContent 与原 content 逐字一致（批注锚点不错位）
        const label =
          sep >= 0 ? (
            <>
              <span className="wiki-hidden">{`${titleRaw}|`}</span>
              {aliasRaw}
            </>
          ) : (
            titleRaw
          );

        if (resolution.status === 'missing') {
          return (
            <span
              className="wiki-link wiki-link-missing"
              title={`「${title}」还没有对应的知识点`}
              role="link"
              aria-disabled="true"
            >
              <span className="wiki-hidden">[[</span>
              {label}
              <span className="wiki-hidden">]]</span>
            </span>
          );
        }

        return (
          <Link
            href={`/segments/${resolution.target.segmentId}`}
            className="wiki-link"
            title={
              resolution.ambiguous
                ? `「${title}」存在多个同名知识点，已打开其中一个`
                : `${resolution.target.documentTitle ?? ''} · ${resolution.target.title}`
            }
          >
            <span className="wiki-hidden">[[</span>
            {label}
            <span className="wiki-hidden">]]</span>
          </Link>
        );
      },
    }),
    [index, documentTitle],
  );

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkWikiLink]}
        components={components}
        // 放行自定义 wiki: 协议（默认清洗会把它抹成空 href），其余仍走默认安全清洗
        urlTransform={(url) => (url.startsWith('wiki:') ? url : defaultUrlTransform(url))}
      >
        {content}
      </Markdown>
    </div>
  );
}
