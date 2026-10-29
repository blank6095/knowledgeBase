import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import type { PgBatchItem } from '@/lib/db-batch';

const WIKI_PATTERN = String.raw`\[\[([^\]|]+)(?:\|[^\]]*)?\]\]`;

/**
 * 重建指定段参与的 wiki/tag 关系。
 * 查询与写入放在同一 batch，调用方可把结构更新和关系重建合并为一个事务。
 */
export function rebuildLinksQueries(segmentIds: string[]): PgBatchItem[] {
  if (segmentIds.length === 0) return [];
  const ids = sql`ARRAY[${sql.join(segmentIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;

  return [
    db.execute(sql`
      DELETE FROM ${links}
      WHERE ${links.kind} IN ('wiki', 'tag')
        AND (${links.fromId} = ANY(${ids}) OR ${links.toId} = ANY(${ids}))
    `),
    db.execute(sql`
      INSERT INTO "links" ("from_id", "to_id", "kind", "weight")
      SELECT DISTINCT s.id, t.id, 'wiki', 1
      FROM segments s
      CROSS JOIN LATERAL regexp_matches(s.content, ${WIKI_PATTERN}, 'g') AS target(match)
      JOIN segments t ON lower(btrim(target.match[1])) = lower(t.title)
      WHERE (s.id = ANY(${ids}) OR t.id = ANY(${ids}))
        AND s.id <> t.id
      ON CONFLICT DO NOTHING
    `),
    db.execute(sql`
      INSERT INTO "links" ("from_id", "to_id", "kind", "weight")
      SELECT DISTINCT
        s.id,
        t.id,
        'tag',
        LEAST(
          1::real,
          cardinality(ARRAY(
            SELECT unnest(s.tags || sd.tags)
            INTERSECT
            SELECT unnest(t.tags || td.tags)
          )) / 3.0
        )
      FROM segments s
      JOIN documents sd ON sd.id = s.document_id
      JOIN segments t ON t.id <> s.id
      JOIN documents td ON td.id = t.document_id
      WHERE (s.id = ANY(${ids}) OR t.id = ANY(${ids}))
        AND s.id::text < t.id::text
        AND (s.tags || sd.tags) && (t.tags || td.tags)
      ON CONFLICT DO NOTHING
    `),
  ];
}
/** 重建一个文档的顺序链与 segment_count；可与其他写操作组成同一事务。 */
export function rebuildDocQueries(documentId: string): PgBatchItem[] {
  return [
    db.execute(sql`
      DELETE FROM ${links}
      WHERE ${links.kind} = 'doc'
        AND ${links.fromId} IN (
          SELECT ${segments.id} FROM ${segments}
          WHERE ${segments.documentId} = ${documentId}
        )
    `),
    db.execute(sql`
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY order_index, created_at, id) AS rn
        FROM segments
        WHERE document_id = ${documentId}
      )
      INSERT INTO "links" ("from_id", "to_id", "kind", "weight")
      SELECT current.id, following.id, 'doc', 0.3
      FROM ordered current
      JOIN ordered following ON following.rn = current.rn + 1
      ON CONFLICT DO NOTHING
    `),
    db.execute(sql`
      UPDATE ${documents}
      SET "segment_count" = (
        SELECT count(*)::int FROM ${segments} WHERE ${segments.documentId} = ${documentId}
      )
      WHERE ${documents.id} = ${documentId}
    `),
  ];
}
