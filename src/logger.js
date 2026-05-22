// winston 日志：控制台 + 按日轮转文件（保留 N 天）
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('./config');

const LOG_DIR = path.join(__dirname, '..', 'logs');

const fmt = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  })
);

const logger = winston.createLogger({
  level: 'info',
  format: fmt,
  transports: [
    new winston.transports.Console(),
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: '%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${config.log_retention_days}d`,
    }),
  ],
});

module.exports = logger;
