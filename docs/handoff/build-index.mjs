import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mdPath = join(here, 'project-dossier.md');
const md = readFileSync(mdPath, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (text) => {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return out;
};

const slug = (text, used) => {
  const base = text.replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'section';
  let s = base;
  let i = 2;
  while (used.has(s)) s = `${base}-${i++}`;
  used.add(s);
  return s;
};

const lines = md.split(/\r?\n/);
const out = [];
const toc = [];
const used = new Set();
let inCode = false;
let codeLang = '';
let codeBuf = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  if (/^```/.test(line)) {
    if (!inCode) {
      inCode = true;
      codeLang = line.slice(3).trim();
      codeBuf = [];
    } else {
      out.push(`<pre><code class="lang-${esc(codeLang)}">${esc(codeBuf.join('\n'))}</code></pre>`);
      inCode = false;
    }
    i++;
    continue;
  }
  if (inCode) {
    codeBuf.push(line);
    i++;
    continue;
  }

  if (!line.trim()) { i++; continue; }

  const heading = line.match(/^(#{1,4})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    const raw = heading[2].trim();
    const id = slug(raw, used);
    out.push(`<h${level} id="${id}">${inline(raw)}</h${level}>`);
    if (level === 2 || level === 3) toc.push({ level, id, text: raw });
    i++;
    continue;
  }

  if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

  if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
    const head = line.split('|').slice(1, -1).map((c) => c.trim());
    const aligns = lines[i + 1].split('|').slice(1, -1).map((c) => {
      const v = c.trim();
      if (/^:-+:$/.test(v)) return 'center';
      if (/^-+:$/.test(v)) return 'right';
      return 'left';
    });
    i += 2;
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) {
      rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
      i++;
    }
    out.push('<div class="table-wrap"><table><thead><tr>' +
      head.map((c, k) => `<th style="text-align:${aligns[k] || 'left'}">${inline(c)}</th>`).join('') +
      '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, k) => `<td style="text-align:${aligns[k] || 'left'}">${inline(c)}</td>`).join('') + '</tr>').join('') +
      '</tbody></table></div>');
    continue;
  }

  if (/^>/.test(line)) {
    const buf = [];
    while (i < lines.length && /^>/.test(lines[i])) {
      buf.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }
    out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
    continue;
  }

  if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
    const ordered = /^\s*\d+\./.test(line);
    const items = [];
    while (i < lines.length && /^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^(\s*)([-*]|\d+\.)\s+/, ''));
      i++;
    }
    out.push(`<${ordered ? 'ol' : 'ul'}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`);
    continue;
  }

  const para = [line];
  i++;
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\||---+\s*$|(\s*)([-*]|\d+\.)\s+)/.test(lines[i])) {
    para.push(lines[i]);
    i++;
  }
  out.push(`<p>${inline(para.join(' '))}</p>`);
}

let body = out.join('\n');

// 图片内嵌：把相对路径的 screenshots 转为 base64 data URI。
body = body.replace(/src="(screenshots\/[^"]+)"/g, (m, rel) => {
  const abs = join(here, rel);
  if (!existsSync(abs)) return m;
  const ext = rel.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `src="data:${mime};base64,${readFileSync(abs).toString('base64')}"`;
});

const tocHtml = toc.map((t) => `<a class="lvl-${t.level}" href="#${t.id}">${esc(t.text.replace(/`/g, ''))}</a>`).join('');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>个人知识库 · 项目交接说明</title>
<style>
:root{--ink:#182124;--muted:#5d6b70;--line:#dfe5e5;--bg:#f6f5f1;--card:#fff;--accent:#0f766e;--accent-soft:#e6f4f1;--warn:#b45309}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.layout{max-width:1180px;margin:0 auto;padding:32px 24px 80px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:36px}
nav{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 16px}
nav .nav-title{font-size:12px;letter-spacing:.12em;color:var(--muted);margin:0 0 10px;text-transform:uppercase}
nav a{display:block;padding:4px 8px;border-left:2px solid transparent;color:var(--muted);text-decoration:none;font-size:13px;line-height:1.5}
nav a:hover{color:var(--accent);border-left-color:var(--accent);background:var(--accent-soft)}
nav a.lvl-3{padding-left:18px;font-size:12.5px}
main{min-width:0}
.hero{background:linear-gradient(135deg,#0f766e,#115e59);color:#fff;border-radius:18px;padding:30px 34px;margin-bottom:30px;box-shadow:0 10px 30px rgba(15,118,110,.16)}
.hero h1{margin:0 0 10px;font-size:30px;line-height:1.3;letter-spacing:.01em}
.hero p{margin:0;color:#d7ece8;font-size:14px}
.content{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:38px 44px;box-shadow:0 2px 10px rgba(24,33,36,.04)}
.content>h1:first-child{display:none}
h1,h2,h3,h4{line-height:1.35;scroll-margin-top:20px}
h2{font-size:25px;margin:46px 0 14px;padding-bottom:10px;border-bottom:2px solid var(--accent-soft)}
h2::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:10px;vertical-align:3px}
h3{font-size:19px;margin:30px 0 10px;color:#0b4f49}
h4{font-size:16px;margin:22px 0 8px;color:var(--muted)}
p{margin:10px 0}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}
code{font:13px/1.5 "Cascadia Code","JetBrains Mono",Consolas,monospace;background:#eef2f2;border:1px solid #e1e7e7;border-radius:5px;padding:1px 5px}
pre{background:#10201f;color:#e6f2ef;border-radius:12px;padding:18px 20px;overflow:auto;margin:14px 0}
pre code{background:none;border:0;color:inherit;padding:0;font-size:13px;line-height:1.65}
blockquote{margin:16px 0;padding:12px 18px;border-left:4px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;color:#274b47}
blockquote p{margin:0}
.table-wrap{overflow:auto;margin:16px 0;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:620px;font-size:13.5px}
th,td{border-bottom:1px solid var(--line);padding:9px 12px;vertical-align:top}
th{background:#f0f4f3;font-weight:600;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:#fafbf9}
ul,ol{margin:10px 0;padding-left:24px}
li{margin:5px 0}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:10px;display:block;margin:10px 0 4px;box-shadow:0 4px 14px rgba(24,33,36,.08)}
img+em{display:block;color:var(--muted);font-size:13px}
.content p:has(> img){margin:18px 0}
.content p:has(> img) img{margin-bottom:6px}
.footer{margin-top:28px;color:var(--muted);font-size:12.5px;text-align:center}
@media (max-width:900px){
 .layout{grid-template-columns:1fr;padding:18px 12px 60px;gap:18px}
 nav{position:relative;top:0;max-height:none}
 .content{padding:24px 18px}
 .hero{padding:22px 20px}
 .hero h1{font-size:23px}
 table{min-width:520px}
}
@media print{
 body{background:#fff}
 nav{display:none}
 .layout{display:block;max-width:none;padding:0}
 .content,.hero{box-shadow:none;border:0;padding:0}
 h2{page-break-after:avoid}
 .table-wrap,img,pre{page-break-inside:avoid}
}
</style>
</head>
<body>
<div class="layout">
<nav>
<p class="nav-title">目录</p>
${tocHtml}
</nav>
<main>
<header class="hero">
<h1>个人知识库 · 项目交接说明</h1>
<p>面向外部大模型 / 新接手者的单文件说明 · 生成日期 2026-11-02 · 来源：当前磁盘工作区 · 分支 master @ c4c9591</p>
</header>
<article class="content">
${body}
</article>
<footer class="footer">本文件由 docs/handoff/project-dossier.md 生成，图片以 base64 内嵌，可离线打开。</footer>
</main>
</div>
</body>
</html>
`;

writeFileSync(join(here, 'index.html'), html, 'utf8');
console.log(`index.html written: ${(html.length / 1024 / 1024).toFixed(2)} MB, toc=${toc.length}, images=${(html.match(/data:image\//g) || []).length}`);
