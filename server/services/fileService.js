import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function createFileService({ uploadDir }) {
  async function parseDocument({ filePath, mimeType }) {
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword') {
      try {
        const { default: mammoth } = await import('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return { text: result.value, pageCount: 1 };
      } catch (e) {
        return { text: '', pageCount: 1 };
      }
    }
    // PDF 或其他格式暂不支持
    return { text: `[${mimeType} 文件内容]`, pageCount: 1 };
  }

  function saveUpload(fileBuffer, originalName) {
    const ext = path.extname(originalName || '.pdf').toLowerCase();
    const safeName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(uploadDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(fileBuffer));
    return { file_id: crypto.randomUUID(), file_path: filePath, original_name: originalName };
  }

  function deleteFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  function readFile(filePath) {
    return fs.readFileSync(filePath);
  }

  return { saveUpload, parseDocument, deleteFile, readFile };
}

export { createFileService };
