// 邮件告警：SFTP 上传失败时通知管理员（见 design.md 第 8 节）
const nodemailer = require('nodemailer');
const config = require('./config');
const logger = require('./logger');

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:   config.email.smtp.host,
      port:   config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });
  }
  return _transporter;
}

/**
 * 发送告警邮件。失败时只记录日志，不抛错（不影响主流程）。
 * @param {string} subject
 * @param {string} body  纯文本正文
 */
async function sendAlert(subject, body) {
  try {
    await getTransporter().sendMail({
      from:    config.email.from,
      to:      config.email.to.join(','),
      subject,
      text:    body,
    });
    logger.info(`[Email] 告警邮件已发送：${subject}`);
  } catch (err) {
    logger.error(`[Email] 发送失败：${err.message}`);
  }
}

module.exports = { sendAlert };
