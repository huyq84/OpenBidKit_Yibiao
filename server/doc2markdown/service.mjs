// 复用 client/tools/doc2markdown-node 的解析逻辑
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let doc2markdownService = null;
try {
  doc2markdownService = require('../../client/tools/doc2markdown-node/service.cjs');
} catch {
  // 服务不可用
}

async function parseDocument({ filePath, mimeType }) {
  if (!doc2markdownService) {
    const fs = await import('fs');
    const text = fs.readFileSync(filePath, 'utf-8');
    return { text, pageCount: 1 };
  }
  return doc2markdownService.parseDocument({ filePath, mimeType });
}

export { parseDocument };