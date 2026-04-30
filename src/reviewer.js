/**
 * AI 代码审查逻辑
 * 
 * 设计考虑：
 * 1. 大 diff 截断：API 有 token 限制，diff 太长会超限。用字符数控制 + 分文件处理。
 * 2. 超时处理：DeepSeek API 可能响应慢，用 AbortController 控制超时，避免卡死。
 * 3. 错误重试：网络不稳定，用指数退避重试，但有最大次数防止死循环。
 */
const OpenAI = require('openai');

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// === 常量配置 ===
const MAX_CHARS_PER_FILE = 8000;   // 单个文件最大字符数（留余量给 prompt）
const MAX_RETRIES = 2;             // 最大重试次数
const TIMEOUT_MS = 30000;          // API 超时时间 30 秒

/**
 * 带超时的 fetch 封装
 * 为什么用 AbortController：因为 fetch 本身支持取消，这是标准做法。
 * Promise.race 实现超时：谁先完成返回谁，超时就 reject。
 */
function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  const promiseThatTimesOut = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error(`请求超时（${ms / 1000}秒）`));
    });
  });

  return Promise.race([promise, promiseThatTimesOut])
    .finally(() => clearTimeout(timeout));
}

/**
 * 带重试的请求封装
 * 为什么用指数退避：避免重试太频繁导致 API 限流或雪崩。
 * 退避策略：第1次等1s，第2次等2s，第3次等4s...
 */
async function withRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err; // 最后一次也失败，抛出异常

      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s...
      console.warn(`⚠️ 审查失败，${delay / 1000}s 后重试 (${i + 1}/${retries})`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 审查单个文件，返回行内评论列表
 * 
 * 关键设计：
 * - 限制字符数：防止超出 API 的 token 限制
 * - 检查空 patch：二进制文件或太大无法显示的文件没有 patch
 * - 解析容错：AI 可能返回非标准 JSON，提取 JSON 部分尝试解析
 */
async function reviewFile(file) {
  const { filename, patch } = file;

  // 没有 patch（文件太大、二进制文件、重命名/删除）→ 跳过
  if (!patch) {
    console.log(`⏭️  跳过 ${filename}（无 patch）`);
    return [];
  }

  // 大 diff 截断
  let truncatedPatch = patch;
  if (patch.length > MAX_CHARS_PER_FILE) {
    console.warn(`⚠️  ${filename} diff 过长 (${patch.length} chars)，已截断`);
    truncatedPatch = patch.slice(0, MAX_CHARS_PER_FILE) + '\n\n...（内容已截断）';
  }

  // 构建 prompt
  const prompt = buildPrompt(filename, truncatedPatch);

  // 带超时和重试的请求
  const response = await withRetry(() =>
    withTimeout(
      deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      }),
      TIMEOUT_MS
    )
  );

  const text = response.choices[0].message.content;

  // 解析 JSON（容错：AI 可能返回带 markdown 代码块的 JSON）
  return parseReviewResponse(text, filename);
}

/**
 * 构建审查 prompt
 */
function buildPrompt(filename, patch) {
  return `你是资深前端工程师，审查以下代码变更。

要求：
- 只指出重要问题（bug、安全隐患、性能问题）
- 每个问题要具体（哪一行、什么问题、为什么）
- 用中文，Markdown 格式
- 只输出 JSON 数组，不要其他内容

JSON 格式：
[{"line": 行号, "body": "问题描述"}, ...]

输出示例：
[
  {"line": 15, "body": "⚠️ **XSS 风险**：\`innerHTML\` 直接插入用户输入，建议用 \`textContent\` 或转义"},
  {"line": 23, "body": "💡 **性能**：每次渲染都创建新数组，建议用 \`useMemo\`"}
]

文件：${filename}
\`\`\`diff
${patch}
\`\`\``;
}

/**
 * 解析审查响应
 * 容错设计：AI 可能返回各种奇怪格式，尝试提取 JSON 部分解析
 */
function parseReviewResponse(text, filename) {
  try {
    // 尝试提取 JSON 数组（可能在 markdown 代码块里）
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.warn(`⚠️  ${filename} 解析失败：未找到 JSON`);
      return [];
    }

    const comments = JSON.parse(jsonMatch[0]);

    // 过滤无效评论（没有 line 或没有 body）
    return comments
      .filter(c => c.line && c.body)
      .map(c => ({
        path: filename,
        line: Number(c.line),
        body: c.body,
      }));
  } catch (e) {
    console.error(`❌ ${filename} 解析异常:`, e.message);
    return [];
  }
}

/**
 * 审查整个 PR
 * 
 * 关键设计：
 * - 串行审查文件：避免并发请求过多导致 API 限流
 * - 收集所有评论：最后一次性发送 Review
 * - 失败不中断：一个文件失败继续处理其他的
 */
async function reviewPR(files) {
  const allComments = [];

  console.log(`📄 共 ${files.length} 个文件待审查`);

  for (const file of files) {
    try {
      console.log(`🔍 审查中: ${file.filename}`);
      const comments = await reviewFile(file);
      allComments.push(...comments);
      console.log(`   → 发现 ${comments.length} 个问题`);
    } catch (err) {
      // 单个文件失败不中断，记录后继续
      console.error(`❌ ${file.filename} 审查失败:`, err.message);
    }
  }

  // 生成总评论
  let summary;
  if (allComments.length === 0) {
    summary = '✅ **看起来不错！** 没有发现明显问题。';
  } else {
    summary = `📋 **发现 ${allComments.length} 个问题**\n\n点击下方具体评论查看详情。`;
  }

  return { summary, comments: allComments };
}

module.exports = { reviewPR };