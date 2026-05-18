import { Router } from 'express';

export function registerAiRoutes(app, services) {
  const router = Router();
  const { aiService, configStore } = services;

  router.post('/api/ai/chat', async (req, res) => {
    try {
      const config = configStore.load();
      const { messages, temperature, response_format } = req.body;
      const content = await aiService.chat(config, { messages, temperature, response_format });
      res.json({ content });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ai/chat/stream', async (req, res) => {
    try {
      console.error('[AI_ROUTE] /api/ai/chat/stream called, body keys:', Object.keys(req.body));
      const config = configStore.load();
      console.error('[AI_ROUTE] config loaded, api_key exists:', !!config.api_key, 'base_url:', config.base_url);
      const { messages, temperature, response_format } = req.body;
      console.error('[AI_ROUTE] messages count:', messages?.length, 'temperature:', temperature, 'response_format:', JSON.stringify(response_format));
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      let eventCount = 0;
      await aiService.chatStream(config, { messages, temperature, response_format }, (event) => {
        eventCount++;
        console.error('[AI_ROUTE] event', eventCount, ':', JSON.stringify(event).slice(0, 100));
        if (event.type === 'done') {
          res.write('data: [DONE]\n\n');
        } else if (event.type === 'content') {
          res.write(`data: ${JSON.stringify({ content: event.content })}\n\n`);
        }
      });
      console.error('[AI_ROUTE] chatStream finished, total events:', eventCount);
      res.end();
    } catch (error) {
      console.error('[AI_ROUTE] /api/ai/chat/stream error:', error.message, error.stack);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ai/test', async (req, res) => {
    try {
      const { api_key, base_url, model_name } = req.body;
      const config = { api_key, base_url, model_name };
      await aiService.chat(config, { messages: [{ role: 'user', content: 'hi' }] });
      res.json({ success: true, message: 'AI 连接成功' });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  router.post('/api/ai/test-image-model', async (req, res) => {
    try {
      const config = req.body;
      console.error('[DEBUG] route received config.image_model:', JSON.stringify(config.image_model));
      const result = await aiService.testImageModel(config);
      res.json({ status: 'available', result });
    } catch (error) {
      res.json({ status: 'unavailable', message: error.message });
    }
  });

  app.use(router);
}