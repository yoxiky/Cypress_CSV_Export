// 服务入口：加载配置 → 初始化日志 → 测试 MySQL → 启动 cron 调度
const logger = require('./logger');
const { testConnection, pool } = require('./mysql');
const { startCron } = require('./cron');

async function main() {
  logger.info('=== Cypress CSV Export 服务启动 ===');

  // MySQL 连通性检查
  try {
    logger.info('正在测试 MySQL 连接...');
    await testConnection();
    logger.info('MySQL 连接测试成功');
  } catch (err) {
    logger.error(`MySQL 连接失败：${err.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  // 注册 cron 任务（从 DB 读取客户配置）
  await startCron();

  logger.info('服务启动完成，等待定时任务触发...');
}

main().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});
