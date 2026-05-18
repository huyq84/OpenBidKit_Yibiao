/**
 * Web 版 API Client — 替换 Electron 的 window.sogplan IPC 调用
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3010';

function parseJson(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ============================================================
// AI
// ============================================================
const ai = {
  async chat(request) {
    const { messages, temperature = 0.3, response_format } = request;
    const body = { messages, temperature };
    if (response_format) body.response_format = response_format;
    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await parseJson(res);
    return data.content || '';
  },

  async streamChat(request, onEvent) {
    const { messages, temperature = 0.3, response_format } = request;
    console.error('[CLIENT] streamChat called, messages count:', messages?.length, 'temperature:', temperature, 'response_format:', JSON.stringify(response_format));
    const res = await fetch(`${API_BASE}/api/ai/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature, response_format }),
    });
    console.error('[CLIENT] streamChat response status:', res.status, 'ok:', res.ok);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            eventCount++;
            console.error('[CLIENT] streamChat event', eventCount, ': done');
            onEvent({ type: 'done' });
          }
          else {
            try {
              const parsed = JSON.parse(data);
              eventCount++;
              console.error('[CLIENT] streamChat event', eventCount, ':', JSON.stringify(parsed).slice(0, 120));
              if (parsed.content) {
                console.error('[CLIENT] calling onEvent content, length:', parsed.content.length);
                onEvent({ type: 'content', content: parsed.content });
              } else {
                console.error('[CLIENT] parsed.content is empty, skipping onEvent');
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    }
    console.error('[CLIENT] streamChat loop ended, total events:', eventCount);
  },

  async requestJson(request) {
    const { messages, temperature = 0.3, schemaName } = request;
    const content = await this.chat({ messages, temperature, response_format: { type: 'json_object' } });
    try { return JSON.parse(content); }
    catch { throw new Error('AI 返回内容无法解析为 JSON'); }
  },

  async testImageModel(config) {
    const res = await fetch(`${API_BASE}/api/ai/test-image-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_model: config }),
    });
    return parseJson(res);
  },
};

// ============================================================
// Tasks
// ============================================================
const tasks = {
  startBidAnalysis: (payload) => tasks.start('bid-analysis', payload),
  startOutlineGeneration: (payload) => tasks.start('outline-generation', payload),
  startContentGeneration: (payload) => tasks.start('content-generation', payload),
  startPreAnalysis: (payload) => tasks.start('pre-analysis', payload),

  async start(type, payload) {
    const res = await fetch(`${API_BASE}/api/tasks/${type}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  getActiveTasks: () => fetch(`${API_BASE}/api/tasks/active`).then(r => r.json()),

  onTaskEvent(callback) {
    // Web SSE 订阅
    const es = new EventSource(`${API_BASE}/api/tasks/events`);
    es.onmessage = (event) => {
      try { callback(JSON.parse(event.data)); } catch {}
    };
    return () => es.close();
  },
};

// ============================================================
// Workspace
// ============================================================
const workspace = {
  loadTechnicalPlan: () => fetch(`${API_BASE}/api/workspace/technical-plan`).then(r => r.json()),

  saveTechnicalPlan: (state) => fetch(`${API_BASE}/api/workspace/technical-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).then(r => r.json()),

  updateTechnicalPlan: (partial) => fetch(`${API_BASE}/api/workspace/technical-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  }).then(r => r.json()),

  clearTechnicalPlan: () => fetch(`${API_BASE}/api/workspace/technical-plan`, {
    method: 'DELETE',
  }).then(r => r.json()),
};

// ============================================================
// File
// ============================================================
const file = {
  importDocument: async () => {
    // Web 版：触发文件选择，返回 { file_path, content }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.docx,.doc';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return reject(new Error('未选择文件'));
        const buffer = await f.arrayBuffer();
        const result = await fetch(`${API_BASE}/api/files/upload`, {
          method: 'POST',
          body: (() => {
            const fd = new FormData();
            fd.append('file', new Blob([buffer]), f.name);
            return fd;
          })(),
        }).then(r => r.json());
        resolve(result);
      };
      input.click();
    });
  },
};

// ============================================================
// Knowledge Base
// ============================================================
const knowledgeBase = {
  list: () => fetch(`${API_BASE}/api/knowledge/documents`).then(r => r.json()),

  createFolder: (name) => fetch(`${API_BASE}/api/knowledge/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(r => r.json()),

  renameFolder: (folderId, name) => fetch(`${API_BASE}/api/knowledge/folders/${folderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(r => r.json()),

  deleteFolder: (folderId) => fetch(`${API_BASE}/api/knowledge/folders/${folderId}`, {
    method: 'DELETE',
  }).then(r => r.json()),

  deleteDocument: (documentId) => fetch(`${API_BASE}/api/knowledge/documents/${documentId}`, {
    method: 'DELETE',
  }).then(r => r.json()),

  uploadDocuments: async (folderId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.docx,.doc,.txt';
    return new Promise((resolve, reject) => {
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        const results = [];
        for (const f of files) {
          const buffer = await f.arrayBuffer();
          const fd = new FormData();
          fd.append('file', new Blob([buffer]), f.name);
          fd.append('folder_id', folderId);
          const r = await fetch(`${API_BASE}/api/knowledge/upload`, {
            method: 'POST',
            body: fd,
          }).then(r => r.json());
          results.push(r);
        }
        resolve({ documents: results });
      };
      input.click();
    });
  },

  startMatching: (documentId, batchSize) => fetch(`${API_BASE}/api/knowledge/documents/${documentId}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: batchSize }),
  }).then(r => r.json()),

  readMarkdown: (documentId) => fetch(`${API_BASE}/api/knowledge/documents/${documentId}/markdown`).then(r => r.json()),
  readItems: (documentId) => fetch(`${API_BASE}/api/knowledge/documents/${documentId}/items`).then(r => r.json()),
  readAnalysis: (documentId) => fetch(`${API_BASE}/api/knowledge/documents/${documentId}/analysis`).then(r => r.json()),

  onEvent(callback) {
    const es = new EventSource(`${API_BASE}/api/knowledge/events`);
    es.onmessage = (event) => {
      try { callback(JSON.parse(event.data)); } catch {}
    };
    return () => es.close();
  },
};

// ============================================================
// Config
// ============================================================
const config = {
  load: () => fetch(`${API_BASE}/api/config`).then(r => r.json()),
  save: (cfg) => fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  }).then(r => r.json()),
  listModels: () => fetch(`${API_BASE}/api/config/list-models`).then(r => r.json()),
  openConfigFolder: () => {},  // Web 不支持
};

// ============================================================
// Export
// ============================================================
const exportApi = {
  exportWord: async (payload) => {
    const res = await fetch(`${API_BASE}/api/export/word`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  onWordExportProgress(callback) {
    // Web SSE
    const es = new EventSource(`${API_BASE}/api/export/word/progress`);
    es.onmessage = (event) => {
      try { callback(JSON.parse(event.data)); } catch {}
    };
    return () => es.close();
  },
};

// ============================================================
// App
// ============================================================
const app = {
  getVersion: () => Promise.resolve('0.1.0'),
  getLatestVersion: () => Promise.resolve({ version: '0.1.0', name: '', body: '', published_at: '', html_url: '' }),
  startUpdate: () => {},
  quitAndInstall: () => {},
};

const platform = 'web';

export const sogplan = {
  // Electron 特有方法（Web 版直接暴露在根上）
  getVersion: () => Promise.resolve('0.1.0'),
  getLatestVersion: () => Promise.resolve({ version: '0.1.0', name: '', body: '', published_at: '', html_url: '' }),
  onUpdateProgress: (cb) => () => {},
  onUpdateDownloaded: (cb) => () => {},
  onUpdateError: (cb) => () => {},
  startUpdate: () => {},
  quitAndInstall: () => {},
  openConfigFolder: () => {},

  // 子模块
  app,
  platform,
  ai,
  tasks,
  workspace,
  file,
  knowledgeBase,
  config,
  export: exportApi,
};

export default sogplan;