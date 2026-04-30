/**
 * GitHub API 封装
 */
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const { HttpsProxyAgent } = require('https-proxy-agent');

let agent;
if (process.env.HTTPS_PROXY) {
  agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
}

function getOctokit(installationId) {
  const privateKey = process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey,
      installationId,
    },
    request: { agent },
  });
}

/**
 * 获取 PR 的文件列表
 */
async function getPRFiles(octokit, { owner, repo, prNumber }) {
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });
  return files;
}

/**
 * 发送行内评论（Review）
 */
async function postReviewComments(octokit, { owner, repo, prNumber, comments, reviewBody }) {
  // 创建 Review，包含多个行内评论
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: 'COMMENT', // 不批准也不请求更改，只是评论
    body: reviewBody, // PR 底部的总评论
    comments: comments.map(c => ({
      path: c.path,
      body: c.body,
      line: c.line,       // 具体行号
      side: 'RIGHT',      // 'LEFT' 是旧代码，'RIGHT' 是新代码
    })),
  });
}

/**
 * 发送普通评论（只有底部总评论，没有行内评论）
 */
async function postComment(octokit, { owner, repo, prNumber, body }) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

module.exports = {
  getOctokit,
  getPRFiles,
  postReviewComments,
  postComment,
};