// node --test test/csv-builder.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../src/csv-builder');

const BOM  = '﻿';
const CRLF = '\r\n';

// ── 结构 ──────────────────────────────────────────────────────────────────────

test('空数据集：只输出 BOM + 表头行', () => {
  const csv = build([]);
  assert.equal(csv, BOM + 'size,name,stock,price' + CRLF);
});

test('BOM 是第一个字符', () => {
  assert.equal(build([]).charCodeAt(0), 0xFEFF);
});

test('所有行尾为 CRLF，无单独 LF', () => {
  const csv = build([{ size: 'A', name: 'B', stock: 1, price: 10 }]);
  // 不含孤立 \n（每个 \n 前必须有 \r）
  const stripped = csv.replace(/\r\n/g, '');
  assert.ok(!stripped.includes('\n'), '存在孤立的 LF');
  assert.ok(!stripped.includes('\r'), '存在孤立的 CR');
});

test('表头固定为 size,name,stock,price', () => {
  const lines = build([]).split(CRLF);
  assert.equal(lines[0], 'size,name,stock,price');
});

// ── 正常数据行 ────────────────────────────────────────────────────────────────

test('单行数据输出正确', () => {
  const csv = build([{ size: '195/65R15', name: 'HL 195/65R15', stock: 8, price: 100 }]);
  const lines = csv.split(CRLF).filter(Boolean);
  assert.equal(lines.length, 2); // 表头 + 1 行
  assert.equal(lines[1], '195/65R15,HL 195/65R15,8,100');
});

test('多行数据顺序正确', () => {
  const rows = [
    { size: 'A', name: 'N1', stock: 1, price: 10 },
    { size: 'B', name: 'N2', stock: 2, price: 20 },
    { size: 'C', name: 'N3', stock: 3, price: 30 },
  ];
  const lines = build(rows).split(CRLF).filter(Boolean);
  assert.equal(lines.length, 4);
  assert.equal(lines[1], 'A,N1,1,10');
  assert.equal(lines[2], 'B,N2,2,20');
  assert.equal(lines[3], 'C,N3,3,30');
});

// ── 转义规则 ──────────────────────────────────────────────────────────────────

test('字段含逗号 → 加引号', () => {
  const csv = build([{ size: 'X', name: 'A,B', stock: 1, price: 10 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, 'X,"A,B",1,10');
});

test('字段含双引号 → 引号加倍并包裹', () => {
  const csv = build([{ size: 'X', name: 'Say "hello"', stock: 1, price: 10 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, 'X,"Say ""hello""",1,10');
});

test('字段含换行符 → 加引号', () => {
  const csv = build([{ size: 'X', name: 'line1\nline2', stock: 1, price: 10 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, 'X,"line1\nline2",1,10');
});

test('字段含逗号和双引号 → 同时处理', () => {
  const csv = build([{ size: 'X', name: 'A,"B"', stock: 1, price: 10 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, 'X,"A,""B""",1,10');
});

test('普通字段不加引号（无多余引号污染）', () => {
  const csv = build([{ size: '205/55R16', name: 'GL 205/55R16', stock: 4, price: 89 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, '205/55R16,GL 205/55R16,4,89');
});

// ── 中文及特殊字符 ────────────────────────────────────────────────────────────

test('中文字段正常输出（无转义）', () => {
  const csv = build([{ size: '195/65R15', name: '品牌 195/65R15', stock: 8, price: 100 }]);
  const dataLine = csv.split(CRLF)[1];
  assert.equal(dataLine, '195/65R15,品牌 195/65R15,8,100');
});
