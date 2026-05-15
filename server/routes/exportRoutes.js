import { Router } from 'express';

export function registerExportRoutes(app, services) {
  const router = Router();
  const { exportService } = services;

  router.get('/api/export/word/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    req.on('close', () => {});
  });

  router.post('/api/export/word', async (req, res) => {
    try {
      const { content, output_file_name } = req.body;
      const outputPath = `/tmp/${output_file_name || 'export.docx'}`;
      const result = await exportService.exportToWord(content, outputPath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use(router);
}