import { runContentGenerationTask as runOriginal } from '../../client/electron/services/contentGenerationTask.cjs';

async function runContentGenerationTask({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload }) {
  return runOriginal({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload });
}

export { runContentGenerationTask };