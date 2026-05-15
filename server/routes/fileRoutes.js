import { Router } from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

export function registerFileRoutes(app, services) {
  const router = Router();
  const { fileService } = services;

  router.post('/api/files/upload', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: '未上传文件' });

      // 保存并解析文件
      const saved = fileService.saveUpload(file.buffer, file.originalname);
      const mimeType = file.originalname.endsWith('.pdf') ? 'application/pdf'
        : file.originalname.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/msword';

      let fileContent = '';
      let parserLabel = 'local';

      try {
        const parsed = await fileService.parseDocument({ filePath: saved.file_path, mimeType });
        fileContent = parsed.content || parsed.text || '';
        parserLabel = parsed.parser_label || 'local';
      } catch (parseError) {
        // 解析失败也继续
        console.warn('文件解析失败:', parseError.message);
      }

      res.json({
        success: true,
        file_path: saved.file_path,
        file_name: file.originalname,
        file_content: fileContent,
        parser_label: parserLabel,
        message: fileContent ? '文件解析成功' : '文件上传成功（内容提取失败）',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/files/parse', async (req, res) => {
    try {
      const { file_path, mime_type } = req.body;
      const result = await fileService.parseDocument({ filePath: file_path, mimeType: mime_type });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/files/:file_id', (req, res) => {
    // 提供文件下载
    res.json({ file_id: req.params.file_id });
  });

  app.use(router);
}