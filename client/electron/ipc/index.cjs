const { ipcMain } = require('electron');
const { registerAiIpc } = require('./aiIpc.cjs');
const { registerConfigIpc } = require('./configIpc.cjs');
const { registerExportIpc } = require('./exportIpc.cjs');
const { registerFileIpc } = require('./fileIpc.cjs');
const { registerKnowledgeBaseIpc } = require('./knowledgeBaseIpc.cjs');
const { registerTaskIpc } = require('./taskIpc.cjs');
const { registerWorkspaceIpc } = require('./workspaceIpc.cjs');
const { createAiService } = require('../services/aiService.cjs');
const { createConfigStore } = require('../services/configStore.cjs');
const { createExportService } = require('../services/exportService.cjs');
const { createFileService } = require('../services/fileService.cjs');
const { createKnowledgeBaseService } = require('../services/knowledgeBaseService.cjs');
const { createTaskService } = require('../services/taskService.cjs');
const { createWorkspaceStore } = require('../services/workspaceStore.cjs');

function registerIpcHandlers({ app, mainWindow }) {
  const configStore = createConfigStore(app);
  const aiService = createAiService({ app, configStore });
  const fileService = createFileService({ configStore });
  const exportService = createExportService();
  const knowledgeBaseService = createKnowledgeBaseService({ app, aiService, configStore });
  const workspaceStore = createWorkspaceStore(app);
  const taskService = createTaskService({ aiService, workspaceStore, knowledgeBaseService });

  registerConfigIpc({ configStore, aiService });
  registerAiIpc({ aiService });
  registerFileIpc({ fileService });
  registerKnowledgeBaseIpc({ knowledgeBaseService });
  registerExportIpc({ exportService });
  registerWorkspaceIpc({ workspaceStore });
  registerTaskIpc({ taskService });

  ipcMain.handle('app:get-version', () => app.getVersion());

  // Update handlers - these are stubbed out since auto-update is removed
  ipcMain.handle('app:get-latest-version', async () => {
    return {
      version: app.getVersion(),
      name: '',
      body: '',
      published_at: '',
      html_url: '',
    };
  });

  ipcMain.handle('app:quit-and-install', () => {
    // No-op since auto-update is removed
  });

  ipcMain.handle('app:start-update', async () => {
    // No-op since auto-update is removed
  });
}

module.exports = {
  registerIpcHandlers,
};
