// 价格计算（见 design.md 3.6 节）
// 返回四舍五入的整数，或 null（表示该商品应跳过）

/**
 * @param {object} p
 * @param {string} p.priceStrategy  'Class A' | 'Class B' | 'Class C'
 * @param {number|null} p.aPrice
 * @param {number|null} p.promotionPrice
 * @param {number} p.isSpecialOffer  0 或 1
 * @param {number} p.priceBIncrease  departments.price_b_increase（澳元加价）
 * @param {number} p.priceCIncrease  departments.price_c_increase（系数，如 1.2）
 * @returns {number|null}
 */
function calculatePrice({ priceStrategy, aPrice, promotionPrice, isSpecialOffer, priceBIncrease, priceCIncrease }) {
  // a_price 缺失或 ≤ 0 → 跳过
  if (!aPrice || aPrice <= 0) return null;

  let price;
  switch (priceStrategy) {
    case 'Class A':
      // 特价商品且有有效 promotion_price → 用特价；否则用 a_price
      if (isSpecialOffer && promotionPrice && promotionPrice > 0) {
        price = promotionPrice;
      } else {
        price = aPrice;
      }
      break;
    case 'Class B':
      // B/C 不应用 promotion_price 逻辑
      price = aPrice + (priceBIncrease || 0);
      break;
    case 'Class C':
      price = aPrice * (priceCIncrease || 1);
      break;
    default:
      throw new Error(`未知 price_strategy: ${priceStrategy}`);
  }

  return Math.round(price);
}

module.exports = { calculatePrice };
