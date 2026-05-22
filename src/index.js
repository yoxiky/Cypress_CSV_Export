// 入口：S1 阶段只做基础设施初始化（config + logger + mysql 连通性）
// 后续阶段会在此之后启动 cron 调度
const logger = require('./logger');
const { testConnection, pool } = require('./mysql');

async function main() {
  logger.info('=== Cypress CSV Export 服务启动 ===');

  try {
    logger.info('正在测试 MySQL 连接...');
    await testConnection();
    logger.info('MySQL 连接测试成功');
  } catch (err) {
    logger.error(`MySQL 连接失败：${err.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  logger.info('S1 骨架就绪，服务已启动');

  // S1 阶段尚未启动任何定时任务或 HTTP 服务，先停留在这里
  // 后续 S8 会替换为 cron 调度的注册
}

main().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});
