require('dotenv').config();
const express = require('express');
const { Webhooks } = require('@octokit/webhooks');
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const OpenAI = require('openai');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const agent = process.env.HTTPS_PROXY 
 ? new HttpsProxyAgent(process.env.HTTPS_PROXY) 
 : undefined;

const app = express();
app.use(express.raw({ type: 'application/json' }));

const privateKey = process.env.GITHUB_PRIVATE_KEY 
 ? process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n')
 : fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, 'utf8');
const webhooks = new Webhooks({ secret: process.env.WEBHOOK_SECRET });

const deepseek = new OpenAI({
 baseURL: 'https://api.deepseek.com/v1',
 apiKey: process.env.DEEPSEEK_API_KEY,
});

function getOctokit(installationId) {
 return new Octokit({
 authStrategy: createAppAuth,
 auth: {
 appId: process.env.APP_ID,
 privateKey: privateKey,
 installationId: installationId,
 },
 request: {
 agent: agent, 
 },
 });
}

app.post('/webhook', async (req, res) => {
 const signature = req.headers['x-hub-signature-256'];
 const payload = req.body.toString('utf8');

 if (!(await webhooks.verify(payload, signature))) {
 return res.status(401).send('Invalid signature');
 }

 const event = JSON.parse(payload);

 if (event.action === 'opened' || event.action === 'synchronize') {
 await reviewPR(event);
 }

 res.status(200).send('OK');
});

async function reviewPR(event) {
 const { repository, pull_request, installation } = event;
 const owner = repository.owner.login;
 const repo = repository.name;
 const prNumber = pull_request.number;

 console.log(`审查 PR #${prNumber} in ${owner}/${repo}`);

 const octokit = getOctokit(installation.id);

 const { data: diff } = await octokit.pulls.get({
 owner,
 repo,
 pull_number: prNumber,
 mediaType: { format: 'diff' },
 });

 const truncatedDiff = diff.slice(0, 8000);
 const review = await deepseek.chat.completions.create({
 model: 'deepseek-chat',
 messages: [{
 role: 'user',
 content: `你是资深前端工程师，审查以下代码变更。指出：
- 潜在 bug 或逻辑问题
- 性能问题
- 代码风格建议
- 安全隐患

只输出重要问题，用中文，Markdown 格式。

代码变更：
\`\`\`diff
${truncatedDiff}
\`\`\``
 }],
 });

 const reviewBody = review.choices[0].message.content;

 await octokit.issues.createComment({
 owner,
 repo,
 issue_number: prNumber,
 body: `## 🤖 AI Code Review\n\n${reviewBody}\n\n---\n*由 DeepSeek 自动生成*`,
 });

 console.log('审查完成，评论已发送');
}

const PORT = process.env.PORT || 3000; // ← Railway 需要这个
app.listen(PORT, () => console.log(`服务器跑在 port ${PORT}`));
