require('dotenv').config();
const express = require('express');
const { Webhooks } = require('@octokit/webhooks');
const { getOctokit, getPRFiles, postReviewComments, postComment } = require('./src/github');
const { reviewPR } = require('./src/reviewer');

const app = express();
app.use(express.raw({ type: 'application/json' }));

// === 检查必须的环境变量 ===
const required = ['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET', 'DEEPSEEK_API_KEY', 'GITHUB_PRIVATE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ 缺少环境变量: ${key}`);
    process.exit(1);
  }
}
console.log('✅ 环境变量检查通过');

const webhooks = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });

// === Webhook 入口 ===
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body.toString('utf8');

  if (!(await webhooks.verify(payload, signature))) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(payload);

  // 只处理 PR opened 和 synchronize
  if (event.action === 'opened' || event.action === 'synchronize') {
    await handlePullRequest(event);
  }

  res.status(200).send('OK');
});

// === 处理 PR ===
async function handlePullRequest(event) {
  const { repository, pull_request, installation } = event;
  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;

  console.log(`🤖 开始审查 PR #${prNumber} in ${owner}/${repo}`);

  try {
    const octokit = getOctokit(installation.id);

    // 1. 获取 PR 的文件列表
    const files = await getPRFiles(octokit, { owner, repo, prNumber });
    console.log(`📄 PR 包含 ${files.length} 个文件`);

    // 2. AI 审查每个文件
    const { summary, comments } = await reviewPR(files);

    // 3. 发送行内评论
    if (comments.length > 0) {
      await postReviewComments(octokit, {
        owner,
        repo,
        prNumber,
        comments,
        reviewBody: `## 🤖 AI Code Review\n\n${summary}\n\n---\n*由 DeepSeek 自动生成*`,
      });
      console.log(`✅ 发送了 ${comments.length} 条行内评论`);
    } else {
      // 没有问题，只发底部评论
      await postComment(octokit, {
        owner,
        repo,
        prNumber,
        body: `## 🤖 AI Code Review\n\n${summary}\n\n---\n*由 DeepSeek 自动生成*`,
      });
      console.log('✅ 审查完成，无问题');
    }
  } catch (err) {
    console.error('审查失败:', err);
  }
}

// === 启动 ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 服务器跑在 port ${PORT}`));