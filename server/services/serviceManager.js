import { createConfigStore } from './configStore.js';
import { createAiService } from './aiService.js';
import { createWorkspaceStore } from './workspaceStore.js';
import { createKnowledgeBaseService } from './knowledgeBaseService.js';
import { createFileService } from './fileService.js';
import { createExportService } from './exportService.js';
import { createTaskService } from './taskService.js';

export function initServices({ workspaceDir, uploadDir, logsDir }) {
  console.error('[SM] initServices starting');
  const configStore = createConfigStore({ configPath: `${workspaceDir}/config.json` });
  const aiService = createAiService({ logsDir, configStore });
  const fileService = createFileService({ uploadDir });
  const exportService = createExportService();
  const workspaceStore = createWorkspaceStore({ workspaceDir });
  const knowledgeBaseService = createKnowledgeBaseService({ workspaceDir, aiService, configStore });
  const taskService = createTaskService({ aiService, workspaceStore, knowledgeBaseService });
  console.error('[SM] all services created, taskService methods:', Object.keys(taskService));

  return { configStore, aiService, fileService, exportService, workspaceStore, knowledgeBaseService, taskService };
}