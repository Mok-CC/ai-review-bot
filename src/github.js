/**
 * GitHub API 封装
 * 
 * 设计考虑：
 * 1. 代理支持：国内需要代理访问 GitHub，可选配置
 * 2. 错误重试：GitHub API 也可能瞬时失败，用重试提高稳定性
 * 3. 类型注释：帮助 IDE 提示和代码可读性
 */
const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const { HttpsProxyAgent } = require('https-proxy-agent');

// === 代理配置 ===
let agent;
if (process.env.HTTPS_PROXY) {
  agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  console.log('🔗 使用代理:', process.env.HTTPS_PROXY);
}

/**
 * 获取 Octokit 实例
 */
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
 * 带重试的 GitHub API 请求
 * 适用场景：网络抖动、GitHub API 限流瞬时恢复
 */
async function withRetry(apiCall, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await apiCall();
    } catch (err) {
      // GitHub API 限流时会有 Retry-After 头
      const retryAfter = err.headers?.['retry-after'];
      
      if (i === retries) throw err;

      // 有明确的等待时间就用它，否则用指数退避
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.pow(2, i) * 1000;

      console.warn(`⚠️ GitHub API 失败，${delay / 1000}s 后重试 (${i + 1}/${retries}): ${err.message}`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取 PR 的文件列表
 */
async function getPRFiles(octokit, { owner, repo, prNumber }) {
  return withRetry(() =>
    octokit.pulls.listFiles({ owner, repo, pull_number: prNumber })
  );
}

/**
 * 发送行内评论（Review）
 * 
 * 关键设计：
 * - 用 Review 而非单个 Comment：一次性发送所有行内评论，体验更好
 * - event: 'COMMENT'：只是评论，不影响 PR 状态（APPROVE/REQUEST_CHANGES 会）
 * - side: 'RIGHT'：新代码侧（即 PR 引入的改动）
 */
async function postReviewComments(octokit, { owner, repo, prNumber, comments, reviewBody }) {
  return withRetry(() =>
    octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: 'COMMENT',
      body: reviewBody,
      comments: comments.map(c => ({
        path: c.path,
        body: c.body,
        line: c.line,
        side: 'RIGHT', // 'RIGHT' = PR 的新代码，'LEFT' = 原代码
      })),
    })
  );
}

/**
 * 发送普通评论（PR 底部留言）
 */
async function postComment(octokit, { owner, repo, prNumber, body }) {
  return withRetry(() =>
    octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    })
  );
}

module.exports = {
  getOctokit,
  getPRFiles,
  postReviewComments,
  postComment,
};