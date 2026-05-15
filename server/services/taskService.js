import crypto from 'crypto';

const taskFields = {
  'bid-analysis': 'bidAnalysisTask',
  'outline-generation': 'outlineGenerationTask',
  'content-generation': 'contentGenerationTask',
};

function getTaskField(type) {
  return taskFields[type] || type;
}

function createTaskService({ aiService, workspaceStore, knowledgeBaseService }) {
  const activeTasks = new Map();
  const subscribers = new Set();

  function now() {
    return new Date().toISOString();
  }

  function createTask(type) {
    return {
      task_id: crypto.randomUUID(),
      type,
      status: 'running',
      progress: 0,
      logs: [],
      started_at: now(),
      updated_at: now(),
    };
  }

  function emit(task, technicalPlan) {
    const event = { task, technicalPlan };
    for (const res of subscribers) {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        subscribers.delete(res);
      }
    }
  }

  function subscribe(res) {
    subscribers.add(res);
    res.on('close', () => subscribers.delete(res));
  }

  function unsubscribe(res) {
    subscribers.delete(res);
  }

  function getActiveTasks() {
    return Array.from(activeTasks.values());
  }

  function startTask(type, payload) {
    console.error('[TASK] startTask called, type:', type);
    const existing = activeTasks.get(type);
    console.error('[TASK] existing task:', existing?.status);
    if (existing?.status === 'running') {
      console.error('[TASK] returning existing running task');
      return existing;
    }

    const task = createTask(type);
    console.error('[TASK] created task:', task.task_id);
    activeTasks.set(type, task);
    const taskField = getTaskField(type);
    console.error('[TASK] taskField:', taskField);
    let currentTask = task;

    const updateTask = (partial, tp) => {
      console.error('[TASK] updateTask called, partial status:', partial.status, 'progress:', partial.progress);
      currentTask = {
        ...currentTask,
        ...partial,
        logs: partial.logs ? partial.logs : currentTask.logs,
        updated_at: now(),
      };
      activeTasks.set(type, currentTask);
      if (tp) emit(currentTask, tp);
      return currentTask;
    };

    console.error('[TASK] loading technicalPlan');
    const technicalPlan = workspaceStore.updateTechnicalPlan({ ...initialPartial, [taskField]: task });
    console.error('[TASK] technicalPlan loaded');

    // 加载对应 runner
    let runner;
    if (type === 'bid-analysis') runner = runBidAnalysisTask;
    else if (type === 'outline-generation') runner = runOutlineGenerationTask;
    else if (type === 'content-generation') runner = runContentGenerationTask;
    console.error('[TASK] runner type:', typeof runner, 'is function:', typeof runner === 'function');

    if (runner) {
      console.error('[TASK] calling runner...');
      runner({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload })
        .then(() => {
          console.error('[TASK] runner completed successfully');
          updateTask({ status: 'success', progress: 100 }, technicalPlan);
        })
        .catch((error) => {
          console.error('[TASK] runner error:', error.message, error.stack);
          updateTask({ status: 'error', logs: [...currentTask.logs, `错误：${error.message}`] }, technicalPlan);
        });
    } else {
      console.error('[TASK] no runner found for type:', type);
    }

    return task;
  }

  const initialPartial = {};
  const loadRunner = (name, path) => {
    try {
      const mod = require(path);
      return mod[name] || mod.default || mod;
    } catch {
      return async () => {};
    }
  };
  const runBidAnalysisTask = loadRunner('runBidAnalysisTask', './bidAnalysisTask.js');
  const runOutlineGenerationTask = loadRunner('runOutlineGenerationTask', './outlineGenerationTask.js');
  const runContentGenerationTask = loadRunner('runContentGenerationTask', './contentGenerationTask.js');

  return { startTask, getActiveTasks, subscribe, unsubscribe };
}

export { createTaskService };