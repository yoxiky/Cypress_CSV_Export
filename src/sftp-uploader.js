// SFTP 上传：原子写入（先写 .tmp 再重命名）+ 重试（见 design.md 6.5 节）
const path = require('path');
const fs = require('fs');
const SftpClient = require('ssh2-sftp-client');
const logger = require('./logger');

const PROJECT_ROOT = path.join(__dirname, '..');

/**
 * 上传 CSV 内容到客户 SFTP，含 3 次重试。
 * @param {object} sftpConfig  来自 customer-config 的 sftp 对象
 * @param {string} filename    如 'QLD.csv'
 * @param {string} content     CSV 字符串（含 BOM）
 * @param {object} [opts]
 * @param {number} [opts.retries=3]          最大尝试次数
 * @param {number} [opts.retryDelayMs=60000] 每次重试前的等待毫秒（测试时可传小值）
 */
async function upload(sftpConfig, filename, content, { retries = 3, retryDelayMs = 60_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await _uploadOnce(sftpConfig, filename, content);
      return; // 成功
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn(`[SFTP] ${filename} 上传失败 (第 ${attempt}/${retries} 次)，${retryDelayMs / 1000}s 后重试：${err.message}`);
        await sleep(retryDelayMs);
      }
    }
  }
  throw new Error(`[SFTP] ${filename} 上传失败（已重试 ${retries} 次）：${lastErr.message}`);
}

async function _uploadOnce(sftpConfig, filename, content) {
  const sftp = new SftpClient();

  const connectOpts = {
    host:     sftpConfig.host,
    port:     sftpConfig.port,
    username: sftpConfig.user,
  };

  if (sftpConfig.authType === 'password') {
    connectOpts.password = sftpConfig.password;
  } else {
    // key 可以是绝对路径或相对项目根目录
    const keyPath = path.isAbsolute(sftpConfig.keyFile)
      ? sftpConfig.keyFile
      : path.join(PROJECT_ROOT, sftpConfig.keyFile);
    connectOpts.privateKey = fs.readFileSync(keyPath);
  }

  await sftp.connect(connectOpts);
  try {
    const remoteDir = sftpConfig.remoteDir.endsWith('/')
      ? sftpConfig.remoteDir
      : sftpConfig.remoteDir + '/';

    const tmpPath   = remoteDir + filename + '.tmp';
    const finalPath = remoteDir + filename;

    // 写入 .tmp，再原子重命名，客户不会读到半成品
    const buf = Buffer.from(content, 'utf8');
    await sftp.put(buf, tmpPath);
    await sftp.rename(tmpPath, finalPath);

    logger.info(`[SFTP] 上传成功：${sftpConfig.host}:${remoteDir}${filename}`);
  } finally {
    await sftp.end();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { upload };
