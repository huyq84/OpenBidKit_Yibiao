import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function createKnowledgeBaseService({ workspaceDir, aiService, configStore }) {
  const kbDir = path.join(workspaceDir, 'knowledge-base');
  fs.mkdirSync(kbDir, { recursive: true });

  function getDocument(id) {
    // placeholder
    return null;
  }

  function getOutlineReferences(documentIds) {
    return { items: [] };
  }

  function getContentReferences(documentIds, chapterContext) {
    return { items: [] };
  }

  function listDocuments() {
    return { folders: [], documents: [] };
  }

  function createFolder(name) {
    return { id: crypto.randomUUID(), name };
  }

  function renameFolder(id, name) {
    return { id, name };
  }

  function deleteFolder(id) {}

  function addDocument(content, metadata) {
    return { id: crypto.randomUUID(), ...metadata };
  }

  function deleteDocument(id) {}

  function startMatching(documentId, batchSize) {}

  return {
    getDocument,
    getOutlineReferences,
    getContentReferences,
    listDocuments,
    createFolder,
    renameFolder,
    deleteFolder,
    addDocument,
    deleteDocument,
    startMatching,
  };
}

export { createKnowledgeBaseService };