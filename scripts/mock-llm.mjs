/**
 * 本地 OpenAI 兼容 mock（验证 /api/ai/* 全链路用，非运行时依赖）：
 * 按system prompt 语义返回带 ```json 围栏与前后废话的固定结构，
 * 顺带验证 llm.ts 的 extractJson 管线。用法：node scripts/mock-llm.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 9377);

const SPLIT = [
  { title: '背景与问题', content: '布局偏移是谷歌用来评估网站性能和用户体验的一个指标。对于字体来说，布局偏移发生在浏览器最初使用备用字体或系统字体渲染文本时。' },
  { title: '替换与后果', content: '然后在自定义字体加载完成后将其替换。这种替换可能会导致文本大小、间距或布局发生变化，从而使其周围的元素发生位移。' },
  { title: '应对策略', content: '应对字体布局偏移的常用做法是为备用字体选择尺寸相近的字体，或使用 `font-display` 与尺寸度量覆盖减少跳动。' },
];

const MERGE = {
  title: '字体布局偏移',
  content: '布局偏移是谷歌用来评估网站性能和用户体验的一个指标。对字体而言，当浏览器最初使用备用字体渲染文本、自定义字体加载完成后再替换时，文本大小、间距或布局可能发生变化，使周围元素位移。常用应对是为备用字体选择尺寸相近的字体，或使用 `font-display` 与尺寸度量覆盖来减少跳动。',
};

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // 验收辅助：记录最近一次请求的 messages（画像注入断言用）
    try {
      const parsed = JSON.parse(body);
      import('node:fs').then(({ writeFileSync }) => {
        writeFileSync('mock-last-request.json', JSON.stringify(parsed, null, 1));
      });
    } catch {}
    const isSummary = body.includes('概括该知识点');
    const isMerge = body.includes('聚合为一个段落');
    if (isSummary) {
      const content = '字体加载过程中的布局偏移及其应对。';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      return;
    }
    const content = isMerge
      ? `模型说明：已融合。\n\`\`\`json\n${JSON.stringify(MERGE)}\n\`\`\`\n以上。`
      : `好的，以下是拆解结果：\n\`\`\`json\n${JSON.stringify(SPLIT)}\n\`\`\`\n希望有帮助！`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});

server.listen(port, () => console.log(`mock-llm listening on :${port}`));
