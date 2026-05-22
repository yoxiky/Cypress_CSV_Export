// 配置加载：读取 config.json，校验必填字段，导出冻结对象
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`配置文件不存在：${CONFIG_PATH}（参考 config.example.json）`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`config.json 解析失败：${err.message}`);
  }

  validate(raw);
  return Object.freeze(raw);
}

function validate(c) {
  // MySQL 必填
  const mysql = c.mysql || {};
  for (const field of ['host', 'port', 'user', 'password', 'database']) {
    if (!mysql[field] && mysql[field] !== 0) {
      throw new Error(`config.mysql.${field} 缺失`);
    }
  }

  // 邮件配置：本期实施 S8 时再校验完整性，S1 不强校验
  // 仅校验 SMTP 主对象存在，便于早期发现
  if (!c.email || !c.email.smtp || !c.email.from || !Array.isArray(c.email.to)) {
    throw new Error('config.email 配置不完整（需要 smtp / from / to）');
  }

  // 其它可选字段给默认值
  if (!c.timezone) c.timezone = 'Australia/Brisbane';
  if (typeof c.archive_retention_days !== 'number') c.archive_retention_days = 7;
  if (typeof c.log_retention_days !== 'number') c.log_retention_days = 14;
}

module.exports = loadConfig();
