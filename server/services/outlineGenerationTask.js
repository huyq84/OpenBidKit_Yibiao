import { runOutlineGenerationTask as runOriginal } from '../../client/electron/services/outlineGenerationTask.cjs';

async function runOutlineGenerationTask({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload }) {
  return runOriginal({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload });
}

export { runOutlineGenerationTask };