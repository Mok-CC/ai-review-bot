/**
 * AI 代码审查逻辑
 */
const OpenAI = require('openai');

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * 审查单个文件，返回行内评论列表
 * @param {object} file - PR 文件信息 { filename, patch, additions, deletions, changes }
 * @returns {Promise<Array>} 评论列表 [{ path, line, body }]
 */
async function reviewFile(file) {
  const { filename, patch } = file;

  // 如果没有 patch（文件太大或二进制文件），跳过
  if (!patch) {
    return [];
  }

  // 限制 patch 大小
  const truncatedPatch = patch.slice(0, 6000);

  const response = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{
      role: 'user',
      content: `你是资深前端工程师，审查以下代码变更。

要求：
- 只指出重要问题（bug、安全隐患、性能问题）
- 每个问题要具体（哪一行、什么问题、为什么）
- 用中文
- Markdown 格式
- 输出 JSON 数组格式，每个元素格式：{"line": 行号, "body": "问题描述"}

输出示例：
[
  {"line": 15, "body": "⚠️ **XSS 风险**：\`innerHTML\` 直接插入用户输入，建议用 \`textContent\` 或转义"},
  {"line": 23, "body": "💡 **性能**：每次渲染都创建新数组，建议用 \`useMemo\`"}
]

只输出 JSON，不要其他内容。

文件：${filename}
\`\`\`diff
${truncatedPatch}
\`\`\``,
    }],
  });

  const text = response.choices[0].message.content;

  // 解析 JSON
  try {
    // 提取 JSON 部分（可能有 markdown 代码块）
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const comments = JSON.parse(jsonMatch[0]);
    return comments.map(c => ({
      path: filename,
      line: c.line,
      body: c.body,
    }));
  } catch (e) {
    console.error(`解析审查结果失败 ${filename}:`, e.message);
    return [];
  }
}

/**
 * 审查整个 PR，返回总评论和行内评论
 */
async function reviewPR(files) {
  const allComments = [];

  // 审查每个文件
  for (const file of files) {
    const comments = await reviewFile(file);
    allComments.push(...comments);
  }

  // 生成总评论
  let summary;
  if (allComments.length === 0) {
    summary = '✅ **看起来不错！** 没有发现明显问题。';
  } else {
    summary = `📋 **发现 ${allComments.length} 个问题**\n\n点击下方具体评论查看详情。`;
  }

  return {
    summary,
    comments: allComments,
  };
}

module.exports = { reviewPR };