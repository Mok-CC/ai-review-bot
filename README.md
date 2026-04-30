# AI Code Review Bot

基于 GitHub App + DeepSeek 的自动代码审查机器人。

## 功能

- 🤖 自动审查 PR 代码变更
- 💬 在具体代码行上发表评论（行内评论）
- 🔍 检测 bug、安全隐患、性能问题
- 📝 Markdown 格式，清晰易读

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
GITHUB_APP_ID=你的App ID
GITHUB_WEBHOOK_SECRET=你的webhook密钥
GITHUB_PRIVATE_KEY=你的私钥（单行，\n换行）
DEEPSEEK_API_KEY=你的DeepSeek API Key
```

### 3. 本地运行

```bash
npm start
```

### 4. 部署到 Railway

1. 推送到 GitHub
2. 在 Railway 创建项目，连接 GitHub 仓库
3. 配置环境变量
4. 部署

## 项目结构

```
ai_review_bot/
├── index.js          # 主入口
├── src/
│   ├── github.js     # GitHub API 封装
│   └── reviewer.js   # AI 审查逻辑
├── .env              # 环境变量（不上传）
└── package.json
```

## 工作原理

1. GitHub PR 事件 → Webhook 发送到服务器
2. 获取 PR 的代码变更（diff）
3. 调用 DeepSeek 分析每个文件
4. 用 Review Comments API 发送行内评论

## License

MIT