# 施工组织设计助手

私有部署版本，禁止外传。

## 项目结构

```
client/               # Electron 桌面应用
├── electron/         # Main 进程
└── src/              # Renderer 进程（React）
tools/                # 文档解析辅助工具
```

## 开发

```bash
cd client
npm install
npm run dev
```

## 构建

```bash
npm run dist
```

## 配置

首次使用需要配置 AI 模型 API Key（支持 OpenAI compatible 接口，推荐 DeepSeek）。

## 注意事项

- 本版本已移除自动更新功能
- 埋点服务需私有部署后配置
