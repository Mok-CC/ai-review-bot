/**
 * 数据库模块 - SQLite
 * 
 * 表结构：
 * - reviews: 每次审查的记录
 *   - id: 唯一 ID (UUID)
 *   - pr_number: PR 编号
 *   - repo: 仓库名 (owner/repo)
 *   - status: success | failed | timeout
 *   - file_count: 审查的文件数
 *   - comment_count: 发现的问题数
 *   - created_at: 创建时间
 */
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'db', 'dashboard.db');

// 确保 db 目录存在
const dbDir = path.dirname(DB_PATH);
require('fs').mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// 初始化表
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    pr_number INTEGER NOT NULL,
    repo TEXT NOT NULL,
    status TEXT NOT NULL,
    file_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);

// 插入一条审查记录
function saveReview({ prNumber, repo, status, fileCount, commentCount }) {
  const stmt = db.prepare(`
    INSERT INTO reviews (id, pr_number, repo, status, file_count, comment_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(uuidv4(), prNumber, repo, status, fileCount, commentCount, new Date().toISOString());
}

// 获取所有审查记录（最近 50 条）
function getReviews() {
  const stmt = db.prepare(`
    SELECT * FROM reviews ORDER BY created_at DESC LIMIT 50
  `);
  return stmt.all();
}

// 获取统计数据
function getStats() {
  const totalReviews = db.prepare('SELECT COUNT(*) as count FROM reviews').get().count;
  const totalIssues = db.prepare('SELECT SUM(comment_count) as sum FROM reviews').get().sum || 0;
  const successCount = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE status = 'success'").get().count;
  const failedCount = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE status = 'failed'").get().count;

  // 最近 7 天的每日统计
  const stmt = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count, SUM(comment_count) as issues
    FROM reviews
    WHERE created_at >= DATE('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);
  const daily = stmt.all();

  // 平均每个文件的问题数
  const avgIssuesPerFile = totalReviews > 0 
    ? (totalIssues / db.prepare('SELECT SUM(file_count) as sum FROM reviews').get().sum || 0).toFixed(2)
    : 0;

  return {
    totalReviews,
    totalIssues,
    successCount,
    failedCount,
    avgIssuesPerFile,
    daily,
  };
}

module.exports = { saveReview, getReviews, getStats };