// MySQL 连接池：基于 mysql2/promise，导出 query() 和 testConnection()
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  connectionLimit: 10,
  timezone: '+10:00', // 布里斯班，无夏令时
  connectTimeout: 30000,
});

/** 执行查询，返回 rows 数组 */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 测试连接，失败抛错 */
async function testConnection() {
  const rows = await query('SELECT 1 AS ok');
  if (!rows.length || rows[0].ok !== 1) {
    throw new Error('SELECT 1 返回异常');
  }
}

module.exports = { pool, query, testConnection };
