// CSV 生成器（见 design.md 3.4 节）
// 输出：UTF-8 BOM + 固定表头 + CRLF 行尾 + RFC 4180 转义

const BOM  = '﻿';
const CRLF = '\r\n';
const HEADER = 'size,name,stock,price';

/** 含逗号/双引号/换行的字段加引号，内部双引号转义为 "" */
function escapeField(value) {
  const s = String(value == null ? '' : value);
  if (s.includes(',') || s.includes('"') || s.includes('\r') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * @param {Array<{size, name, stock, price}>} rows
 * @returns {string}  BOM + 表头 + 数据行，每行以 CRLF 结尾
 */
function build(rows) {
  const lines = [HEADER];
  for (const row of rows) {
    lines.push([
      escapeField(row.size),
      escapeField(row.name),
      escapeField(row.stock),
      escapeField(row.price),
    ].join(','));
  }
  // 每行包括末尾都以 CRLF 结尾
  return BOM + lines.join(CRLF) + CRLF;
}

module.exports = { build };
