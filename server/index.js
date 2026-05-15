import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initServices } from './services/serviceManager.js';
import { registerTaskRoutes } from './routes/taskRoutes.js';
import { registerConfigRoutes } from './routes/configRoutes.js';
import { registerAiRoutes } from './routes/aiRoutes.js';
import { registerFileRoutes } from './routes/fileRoutes.js';
import { registerWorkspaceRoutes } from './routes/workspaceRoutes.js';
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import { registerExportRoutes } from './routes/exportRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const UPLOAD_DIR = join(__dirname, 'uploads');
const WORKSPACE_DIR = join(__dirname, 'workspace');
const AI_LOGS_DIR = join(__dirname, 'logs');

[UPLOAD_DIR, WORKSPACE_DIR, AI_LOGS_DIR].forEach(dir => {
  import('fs').then(fs => fs.mkdirSync(dir, { recursive: true }));
});

const services = initServices({
  workspaceDir: WORKSPACE_DIR,
  uploadDir: UPLOAD_DIR,
  logsDir: AI_LOGS_DIR,
});

registerTaskRoutes(app, services);
registerConfigRoutes(app, services);
registerAiRoutes(app, services);
registerFileRoutes(app, services);
registerWorkspaceRoutes(app, services);
registerKnowledgeRoutes(app, services);
registerExportRoutes(app, services);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`施工组织设计助手 API server running on http://localhost:${PORT}`);
});