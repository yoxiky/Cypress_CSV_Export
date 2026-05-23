// 商品查询：JOIN products + prices，返回指定部门的有效商品
// 品牌黑名单过滤在应用层（不在 SQL），见 design.md 3.2 节
const { query } = require('./mysql');
const { extractBrand } = require('./brand-extractor');

/**
 * 查询指定部门的有效商品（is_active=1, total_stock>0）
 * @param {number} departmentId
 * @param {string[]} brandBlacklist  大写品牌名数组，如 ['KUMHO', 'LINGLONG']
 * @returns {Array<{helperCode, name, stock, isSpecialOffer, aPrice, promotionPrice, departmentId}>}
 */
async function fetchProducts(departmentId, brandBlacklist = []) {
  const rows = await query(
    `SELECT
       p.helper_code,
       p.name,
       p.total_stock,
       p.is_special_offer,
       p.department_id,
       pr.a_price,
       pr.promotion_price
     FROM products p
     LEFT JOIN prices pr ON pr.product_id = p.id
     WHERE p.is_active = 1
       AND p.total_stock > 0
       AND p.department_id = ?`,
    [departmentId]
  );

  return rows
    .filter(row => {
      if (brandBlacklist.length === 0) return true;
      const brand = extractBrand(row.name);
      return !brandBlacklist.includes(brand);
    })
    .map(row => ({
      helperCode:    row.helper_code,
      name:          row.name,
      stock:         row.total_stock > 8 ? 8 : row.total_stock,  // stock 脱敏
      isSpecialOffer: row.is_special_offer,
      aPrice:        row.a_price     ? Number(row.a_price)     : null,
      promotionPrice: row.promotion_price ? Number(row.promotion_price) : null,
      departmentId:  row.department_id,
    }));
}

/**
 * 查询部门的价格加价系数（用于 Class B / Class C 计算）
 * @param {number} departmentId
 * @returns {{ priceBIncrease: number, priceCIncrease: number }}
 */
async function fetchDepartment(departmentId) {
  const rows = await query(
    'SELECT price_b_increase, price_c_increase FROM departments WHERE company_id = ?',
    [departmentId]
  );
  if (!rows.length) {
    throw new Error(`departments 表中找不到 company_id=${departmentId}`);
  }
  return {
    priceBIncrease: Number(rows[0].price_b_increase) || 0,
    priceCIncrease: Number(rows[0].price_c_increase) || 1,
  };
}

module.exports = { fetchProducts, fetchDepartment };
