// node --test test/price-calculator.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculatePrice } = require('../src/price-calculator');

// 基础参数
const base = {
  aPrice: 100,
  promotionPrice: null,
  isSpecialOffer: 0,
  priceBIncrease: 20,
  priceCIncrease: 1.2,
};

// ── Class A ───────────────────────────────────────────────────────────────────

test('Class A：普通商品用 a_price', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A' }), 100);
});

test('Class A：is_special_offer=1 且有 promotion_price → 用特价', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', isSpecialOffer: 1, promotionPrice: 80 }), 80);
});

test('Class A：is_special_offer=1 但 promotion_price 为 null → 用 a_price', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', isSpecialOffer: 1, promotionPrice: null }), 100);
});

test('Class A：is_special_offer=1 但 promotion_price=0 → 用 a_price', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', isSpecialOffer: 1, promotionPrice: 0 }), 100);
});

test('Class A：is_special_offer=0，有 promotion_price → 忽略特价，用 a_price', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', isSpecialOffer: 0, promotionPrice: 80 }), 100);
});

// ── Class B ───────────────────────────────────────────────────────────────────

test('Class B：a_price + price_b_increase', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class B' }), 120);
});

test('Class B：is_special_offer=1 也不应用特价', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class B', isSpecialOffer: 1, promotionPrice: 60 }), 120);
});

// ── Class C ───────────────────────────────────────────────────────────────────

test('Class C：a_price * price_c_increase', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class C' }), 120);
});

test('Class C：is_special_offer=1 也不应用特价', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class C', isSpecialOffer: 1, promotionPrice: 60 }), 120);
});

test('Class C：结果四舍五入', () => {
  // 100 * 1.156 = 115.6 → 116
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class C', priceCIncrease: 1.156 }), 116);
});

// ── a_price 缺失 ──────────────────────────────────────────────────────────────

test('a_price 为 null → 返回 null（跳过商品）', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', aPrice: null }), null);
});

test('a_price 为 0 → 返回 null（跳过商品）', () => {
  assert.equal(calculatePrice({ ...base, priceStrategy: 'Class A', aPrice: 0 }), null);
});

test('未知 price_strategy → 抛错', () => {
  assert.throws(() => calculatePrice({ ...base, priceStrategy: 'Class D' }), /未知 price_strategy/);
});
