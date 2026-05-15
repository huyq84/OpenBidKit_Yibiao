let runOriginal = null;
let isLoaded = false;
const loadPromise = import('../../client/electron/services/bidAnalysisTask.cjs').then((mod) => {
  runOriginal = mod.runBidAnalysisTask || mod.default;
  isLoaded = true;
  console.error('[BID] bidAnalysisTask.cjs loaded successfully, runOriginal type:', typeof runOriginal);
}).catch((err) => {
  console.error('[BID] Failed to load bidAnalysisTask.cjs:', err.message);
});

async function runBidAnalysisTask({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload }) {
  console.error('[BID] runBidAnalysisTask called, isLoaded:', isLoaded, 'runOriginal:', typeof runOriginal);
  
  if (!isLoaded) {
    console.error('[BID] Waiting for runOriginal to load...');
    await loadPromise;
    console.error('[BID] Load completed, runOriginal:', typeof runOriginal);
  }
  
  if (!runOriginal) {
    throw new Error('runBidAnalysisTask 加载失败');
  }
  
  try {
    console.error('[BID] calling runOriginal with payload keys:', Object.keys(payload || {}));
    const result = await runOriginal({ aiService, workspaceStore, knowledgeBaseService, updateTask, payload });
    console.error('[BID] runOriginal completed successfully');
    return result;
  } catch (err) {
    console.error('[BID] runOriginal error:', err.message, err.stack);
    throw err;
  }
}

export { runBidAnalysisTask };
