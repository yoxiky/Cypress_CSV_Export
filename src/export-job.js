// 单客户完整导出任务：查商品 → 算价 → 生成 CSV → 归档 → SFTP 上传
// 一个客户内多个 department 串行执行（见 design.md 6.7 节）
const { fetchProducts, fetchDepartment } = require('./product-fetcher');
const { calculatePrice } = require('./price-calculator');
const { build } = require('./csv-builder');
const { save } = require('./archive');
const { upload } = require('./sftp-uploader');
const { DEPARTMENT_FILENAMES } = require('./customer-config');
const logger = require('./logger');

/**
 * 执行单个客户的完整导出任务。
 * 任一 department 失败 → 记录错误并继续其它 department，最终汇总抛出。
 *
 * @param {object} customerConfig  来自 fetchEnabledCustomers() 的单条记录
 * @returns {string[]}  失败的 department 文件名列表（空数组=全部成功）
 */
async function runExportJob(customerConfig) {
  const { customerCode, departmentIds, priceStrategy, brandBlacklist, sftp } = customerConfig;
  logger.info(`[Job] ${customerCode} 开始，共 ${departmentIds.length} 个部门`);

  const errors = [];

  for (const deptId of departmentIds) {
    const filename = DEPARTMENT_FILENAMES[deptId];
    try {
      await exportOneDepartment({ customerCode, deptId, filename, priceStrategy, brandBlacklist, sftp });
    } catch (err) {
      logger.error(`[Job] ${customerCode}/${filename} 失败：${err.message}`);
      errors.push({ filename, error: err });
    }
  }

  if (errors.length === 0) {
    logger.info(`[Job] ${customerCode} 全部完成`);
  } else {
    logger.warn(`[Job] ${customerCode} 完成，${errors.length} 个部门失败`);
  }

  return errors;
}

async function exportOneDepartment({ customerCode, deptId, filename, priceStrategy, brandBlacklist, sftp }) {
  // 1. 查商品（含黑名单过滤、stock 脱敏）
  const products = await fetchProducts(deptId, brandBlacklist);
  logger.info(`[Job] ${customerCode}/${filename}：查到 ${products.length} 条商品`);

  // 2. 查部门价格系数（Class B/C 用，Class A 也查一次但不影响结果）
  const { priceBIncrease, priceCIncrease } = await fetchDepartment(deptId);

  // 3. 计算价格，过滤掉 a_price 缺失的商品
  let skipped = 0;
  const rows = [];
  for (const p of products) {
    const price = calculatePrice({
      priceStrategy,
      aPrice: p.aPrice,
      promotionPrice: p.promotionPrice,
      isSpecialOffer: p.isSpecialOffer,
      priceBIncrease,
      priceCIncrease,
    });
    if (price === null) {
      skipped++;
      logger.warn(`[Job] ${customerCode}/${filename} 跳过商品（a_price 缺失）：${p.helperCode} ${p.name}`);
      continue;
    }
    rows.push({ size: p.helperCode, name: p.name, stock: p.stock, price });
  }
  if (skipped > 0) {
    logger.warn(`[Job] ${customerCode}/${filename}：共跳过 ${skipped} 条 a_price 缺失商品`);
  }

  // 4. 生成 CSV
  const csv = build(rows);
  logger.info(`[Job] ${customerCode}/${filename}：生成 CSV，${rows.length} 行数据`);

  // 5. 本地归档
  await save(customerCode, filename, csv);

  // 6. SFTP 上传（含 3 次重试）
  await upload(sftp, filename, csv);
}

module.exports = { runExportJob };
