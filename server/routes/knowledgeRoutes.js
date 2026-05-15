import { Router } from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

export function registerKnowledgeRoutes(app, services) {
  const router = Router();
  const { knowledgeBaseService } = services;

  // SSE 事件流
  router.get('/api/knowledge/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    // 简单保持连接
    req.on('close', () => {});
  });

  // 文档列表
  router.get('/api/knowledge/documents', (req, res) => {
    res.json(knowledgeBaseService.listDocuments());
  });

  // 文件夹 CRUD
  router.post('/api/knowledge/folders', (req, res) => {
    const folder = knowledgeBaseService.createFolder(req.body.name);
    res.json(folder);
  });

  router.put('/api/knowledge/folders/:id', (req, res) => {
    const folder = knowledgeBaseService.renameFolder(req.params.id, req.body.name);
    res.json(folder);
  });

  router.delete('/api/knowledge/folders/:id', (req, res) => {
    knowledgeBaseService.deleteFolder(req.params.id);
    res.json({ success: true });
  });

  // 上传文档到文件夹
  router.post('/api/knowledge/upload', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      const { folder_id } = req.body;
      if (!file) return res.status(400).json({ error: '未上传文件' });
      const result = knowledgeBaseService.addDocument(file.buffer.toString('utf-8'), {
        original_name: file.originalname,
        folder_id,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 单文档操作
  router.get('/api/knowledge/documents/:id', (req, res) => {
    res.json(knowledgeBaseService.getDocument(req.params.id));
  });

  router.delete('/api/knowledge/documents/:id', (req, res) => {
    knowledgeBaseService.deleteDocument(req.params.id);
    res.json({ success: true });
  });

  // 文档内容
  router.get('/api/knowledge/documents/:id/markdown', (req, res) => {
    const doc = knowledgeBaseService.getDocument(req.params.id);
    res.json({ markdown: doc?.markdown || '' });
  });

  router.get('/api/knowledge/documents/:id/items', (req, res) => {
    const doc = knowledgeBaseService.getDocument(req.params.id);
    res.json({ items: doc?.items || [] });
  });

  router.get('/api/knowledge/documents/:id/analysis', (req, res) => {
    const doc = knowledgeBaseService.getDocument(req.params.id);
    res.json({ analysis: doc?.analysis || null });
  });

  // 匹配
  router.post('/api/knowledge/documents/:id/match', (req, res) => {
    const { batch_size } = req.body;
    knowledgeBaseService.startMatching(req.params.id, batch_size);
    res.json({ success: true });
  });

  // 知识引用
  router.post('/api/knowledge/references/outline', (req, res) => {
    const { document_ids } = req.body;
    res.json(knowledgeBaseService.getOutlineReferences(document_ids || []));
  });

  router.post('/api/knowledge/references/content', (req, res) => {
    const { document_ids, chapter_context } = req.body;
    res.json(knowledgeBaseService.getContentReferences(document_ids || [], chapter_context));
  });

  app.use(router);
}