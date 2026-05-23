// node --test test/brand-extractor.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractBrand } = require('../src/brand-extractor');

test('正常：名称含空格，取第一个词大写', () => {
  assert.equal(extractBrand('HL 195/65R15'), 'HL');
  assert.equal(extractBrand('linglong 205/55R16'), 'LINGLONG');
});

test('名称不含空格 → OTHER', () => {
  assert.equal(extractBrand('NOSPACENAME'), 'OTHER');
});

test('前后有空格被 trim 后正常提取', () => {
  assert.equal(extractBrand('  HL 195/65R15  '), 'HL');
});

test('纯空格 → OTHER', () => {
  assert.equal(extractBrand('   '), 'OTHER');
});

test('空字符串 → OTHER', () => {
  assert.equal(extractBrand(''), 'OTHER');
});

test('null/undefined → OTHER', () => {
  assert.equal(extractBrand(null), 'OTHER');
  assert.equal(extractBrand(undefined), 'OTHER');
});

test('多个空格：取第一个空格前的部分', () => {
  assert.equal(extractBrand('GL 205 55R16'), 'GL');
});
