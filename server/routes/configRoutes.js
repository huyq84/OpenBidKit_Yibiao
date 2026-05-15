import { Router } from 'express';

export function registerConfigRoutes(app, services) {
  const router = Router();
  const { configStore } = services;

  router.get('/api/config', (req, res) => {
    res.json(configStore.get());
  });

  router.post('/api/config', (req, res) => {
    const updates = req.body;
    const current = configStore.load();
    const updated = { ...current, ...updates };
    configStore.save(updated);
    res.json({ success: true });
  });

  router.get('/api/config/list-models', async (req, res) => {
    const config = configStore.get();
    try {
      const result = await services.aiService.listModels(config);
      res.json(result);
    } catch (e) {
      res.json({ success: false, message: e.message, models: [] });
    }
  });

  app.use(router);
}