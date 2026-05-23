// cron 调度：从 DB 读取客户配置注册定时任务 + 每天 04:00 清理归档
const cron = require('node-cron');
const { fetchEnabledCustomers } = require('./customer-config');
const { runExportJob } = require('./export-job');
const { cleanup } = require('./archive');
const { sendAlert } = require('./email-notifier');
const config = require('./config');
const logger = require('./logger');

const TZ = config.timezone || 'Australia/Brisbane';

/**
 * 启动时调用：读取所有启用的客户，为每个客户注册 cron 任务。
 * 同一时刻多客户并行触发（各自独立 Promise），单客户内部 department 串行。
 */
async function startCron() {
  const customers = await fetchEnabledCustomers();

  if (customers.length === 0) {
    logger.warn('[Cron] 没有启用的客户配置，不注册任何任务');
    return;
  }

  for (const customer of customers) {
    cron.schedule(customer.scheduleCron, () => {
      // 不 await，让各客户并行，互不阻塞
      handleCustomer(customer).catch(() => {}); // 错误已在内部处理
    }, { timezone: TZ });

    logger.info(`[Cron] 已注册：${customer.customerCode}（${customer.scheduleCron}，${TZ}）`);
  }

  // 每天凌晨 04:00 清理过期归档
  cron.schedule('0 4 * * *', () => {
    cleanup().catch(err => logger.error(`[Cron] 归档清理失败：${err.message}`));
  }, { timezone: TZ });

  logger.info(`[Cron] 归档清理任务已注册（每天 04:00 ${TZ}）`);
}

/** 执行单个客户任务，失败时发送告警邮件 */
async function handleCustomer(customer) {
  try {
    const errors = await runExportJob(customer);
    for (const { filename, error } of errors) {
      const subject = `[CSV Export] 客户 ${customer.customerCode} 部门 ${filename} 推送失败`;
      const body = [
        `时间：${new Date().toISOString()}`,
        `客户：${customer.customerCode} (${customer.customerName})`,
        `文件：${filename}`,
        `错误：${error.message}`,
      ].join('\n');
      await sendAlert(subject, body);
    }
  } catch (err) {
    logger.error(`[Cron] ${customer.customerCode} 任务异常：${err.message}`);
    const subject = `[CSV Export] 客户 ${customer.customerCode} 任务异常`;
    await sendAlert(subject, `时间：${new Date().toISOString()}\n错误：${err.message}\n堆栈：${err.stack}`);
  }
}

module.exports = { startCron };
