# 施工组织设计助手 — Web Server

## 快速启动

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env 填入 AI API Key
npm run dev
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| POST | /api/tasks/:type/start | 启动任务（SSE 订阅） |
| GET | /api/tasks/active | 获取活跃任务 |
| GET/POST | /api/workspace | 工作区数据 |
| GET/POST | /api/config | 配置 |
| POST | /api/files/upload | 上传文件 |
| POST | /api/knowledge/documents | 知识库 |
| POST | /api/export/word | Word 导出 |

## 前端改造

1. `client/vite.config.ts` 添加代理：
```ts
server: {
  proxy: {
    '/api': 'http://localhost:3000',
  },
},
```

2. 组件中将 `window.sogplan?.xxx` 替换为从 `apiClient.ts` 导入的函数。