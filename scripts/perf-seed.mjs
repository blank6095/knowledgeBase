import { neon } from '@neondatabase/serverless';

const DOC = '11111111-1111-4111-8111-111111111111';
const sql = neon(process.env.DATABASE_URL);

const cmd = process.argv[2];

if (cmd === 'seed') {
  await sql.query(`delete from documents where id = '${DOC}'`);
  await sql.query(
    `insert into documents (id, title, source, segment_count) values ('${DOC}', 'PERF-TEST-DO-NOT-KEEP', 'paste', 3000)`,
  );
  await sql.query(
    `insert into segments (document_id, title, content, stability, last_viewed_at, view_count)
     select '${DOC}', '压测知识点 ' || i, '这是性能测量用的合成内容。',
       case when i % 4 = 0 then 0 else round((0.3 + (i % 97) * 0.61)::numeric, 2)::real end,
       case when i % 4 = 0 then null else now() - ((i % 90) * interval '1 day') end,
       i % 20
     from generate_series(1, 3000) i`,
  );
  const c = await sql.query(`select count(*)::int n from segments where document_id = '${DOC}'`);
  console.log('seeded segments:', c[0].n);
} else if (cmd === 'clean') {
  await sql.query(`delete from documents where id = '${DOC}'`);
  const c = await sql.query(`select count(*)::int n from segments where document_id = '${DOC}'`);
  const docs = await sql.query(`select count(*)::int n from documents where id = '${DOC}'`);
  console.log('cleanup verified: segments left =', c[0].n, ', docs left =', docs[0].n);
} else {
  console.error('usage: node perf-seed.mjs seed|clean');
  process.exit(1);
}
