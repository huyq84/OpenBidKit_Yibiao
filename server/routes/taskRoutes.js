import { Router } from 'express';

export function registerTaskRoutes(app, services) {
  const router = Router();
  const { taskService, workspaceStore } = services;

  // POST /api/tasks/:type/start — 启动任务
  router.post('/api/tasks/:type/start', (req, res) => {
    const { type } = req.params;
    const payload = req.body;
    console.error('[ROUTE] POST /api/tasks/:type/start', type, 'payload keys:', Object.keys(payload));

    // 设置 SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 立即发送初始任务
    try {
      console.error('[ROUTE] calling taskService.startTask');
      const task = taskService.startTask(type, payload);
      console.error('[ROUTE] startTask returned, task:', JSON.stringify(task));
      res.write(`data: ${JSON.stringify({ task, type: 'init' })}\n\n`);
    } catch (error) {
      console.error('[ROUTE] startTask threw:', error.message, error.stack);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }

    // 订阅任务事件并通过 SSE 推送
    const origSubscribe = taskService.subscribe.bind(taskService);
    taskService.subscribe = (res_) => {
      // 发送当前活跃任务
      for (const task of taskService.getActiveTasks()) {
        res_.write(`data: ${JSON.stringify({ task })}\n\n`);
      }
      origSubscribe(res_);
    };

    // 保持连接活跃
    req.on('close', () => {
      taskService.unsubscribe(res);
    });
  });

  // GET /api/tasks/active — 获取活跃任务列表
  router.get('/api/tasks/active', (req, res) => {
    res.json({ tasks: taskService.getActiveTasks() });
  });

  // GET /api/tasks/events — SSE 事件订阅（客户端轮询监听）
  router.get('/api/tasks/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    // 立即发送当前活跃任务和技术计划
    const technicalPlan = workspaceStore.loadTechnicalPlan();
    for (const task of taskService.getActiveTasks()) {
      res.write(`data: ${JSON.stringify({ task, technicalPlan })}\n\n`);
    }

    taskService.subscribe(res);

    req.on('close', () => {
      taskService.unsubscribe(res);
    });
  });

  app.use(router);
}