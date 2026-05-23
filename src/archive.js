// 本地归档：保存 CSV 文件 + 清理 7 天前的旧目录（见 design.md 6.6 节）
const path = require('path');
const fsp = require('fs/promises');
const config = require('./config');
const logger = require('./logger');

const PROJECT_ROOT = path.join(__dirname, '..');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'archive');

/**
 * 获取当前布里斯班时间的日期和时分，用于归档路径命名。
 * 返回 { date: 'YYYY-MM-DD', time: 'HHmm' }
 */
function getBrisbaneParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const hour = parts.hour === '24' ? '00' : parts.hour; // 处理午夜边界
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: hour + parts.minute,
  };
}

/**
 * 保存 CSV 内容到本地归档目录。
 * 路径：archive/YYYY-MM-DD/{customerCode}/{fileBaseName}_{HHmm}.csv
 * 例：archive/2026-05-22/BIGMART/QLD_1400.csv
 *
 * @param {string} customerCode  如 'BIGMART'
 * @param {string} filename      如 'QLD.csv'
 * @param {string} content       CSV 字符串
 */
async function save(customerCode, filename, content) {
  const { date, time } = getBrisbaneParts();
  const baseName = path.basename(filename, path.extname(filename)); // 'QLD.csv' → 'QLD'
  const archiveName = `${baseName}_${time}.csv`;
  const dir = path.join(ARCHIVE_DIR, date, customerCode);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, archiveName), content, 'utf8');

  logger.info(`[归档] 已保存：archive/${date}/${customerCode}/${archiveName}`);
}

/**
 * 删除 archive/ 下超过 retention_days 天的日期目录。
 * 由 cron 每天 04:00 调用（见 S8）。
 */
async function cleanup(retentionDays = config.archive_retention_days) {
  let entries;
  try {
    entries = await fsp.readdir(ARCHIVE_DIR);
  } catch {
    return; // archive/ 尚不存在，正常
  }

  // 计算截止日期字符串（布里斯班当天 - retentionDays）
  const { date: todayStr } = getBrisbaneParts();
  const cutoff = new Date(todayStr);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue; // 跳过非日期目录
    if (entry < cutoffStr) { // YYYY-MM-DD 字符串可直接比较大小
      await fsp.rm(path.join(ARCHIVE_DIR, entry), { recursive: true, force: true });
      logger.info(`[归档] 已删除过期目录：archive/${entry}`);
    }
  }
}

module.exports = { save, cleanup };
