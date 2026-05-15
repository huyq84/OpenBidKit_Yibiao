import { Router } from 'express';

export function registerWorkspaceRoutes(app, services) {
  const router = Router();
  const { workspaceStore } = services;

  router.get('/api/workspace/technical-plan', (req, res) => {
    res.json(workspaceStore.loadTechnicalPlan());
  });

  router.post('/api/workspace/technical-plan', (req, res) => {
    const updated = workspaceStore.updateTechnicalPlan(req.body);
    res.json(updated);
  });

  router.delete('/api/workspace/technical-plan', (req, res) => {
    workspaceStore.clearTechnicalPlan();
    res.json({ success: true });
  });

  app.use(router);
}