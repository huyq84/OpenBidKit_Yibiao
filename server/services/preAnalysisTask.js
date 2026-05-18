let runOriginal = null;
let isLoaded = false;
const loadPromise = import('../../client/electron/services/preAnalysisTask.cjs').then((mod) => {
  runOriginal = mod.runPreAnalysisTask || mod.default;
  isLoaded = true;
  console.error('[PRE] preAnalysisTask.cjs loaded successfully, runOriginal type:', typeof runOriginal);
}).catch((err) => {
  console.error('[PRE] Failed to load preAnalysisTask.cjs:', err.message);
});

async function runPreAnalysisTask({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload }) {
  console.error('[PRE] runPreAnalysisTask called, isLoaded:', isLoaded, 'runOriginal:', typeof runOriginal);

  if (!isLoaded) {
    console.error('[PRE] Waiting for runOriginal to load...');
    await loadPromise;
    console.error('[PRE] Load completed, runOriginal:', typeof runOriginal);
  }

  if (!runOriginal) {
    throw new Error('runPreAnalysisTask 加载失败');
  }

  try {
    console.error('[PRE] calling runOriginal with payload keys:', Object.keys(payload || {}));
    const result = await runOriginal({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload });
    console.error('[PRE] runOriginal completed successfully');
    return result;
  } catch (err) {
    console.error('[PRE] runOriginal error:', err.message, err.stack);
    throw err;
  }
}

export { runPreAnalysisTask };