// 客户配置读取与解析：从 csv_export_customers 表读取启用的客户，解析并校验各字段
const { query } = require('./mysql');

/** 部门 id → CSV 文件名（写死，不进 DB） */
const DEPARTMENT_FILENAMES = {
  7:  'QLD.csv',
  8:  'GC.csv',
  10: 'NSW.csv',
  15: 'VIC.csv',
};

const VALID_STRATEGIES = new Set(['Class A', 'Class B', 'Class C']);

/**
 * 解析并校验一行 DB 记录，返回结构化对象。
 * 校验失败抛 Error，由上层决定是跳过还是中止。
 */
function parseCustomer(row) {
  const code = row.customer_code;

  // department_ids: '7,10' → [7, 10]
  const departmentIds = String(row.department_ids)
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n));

  if (departmentIds.length === 0) {
    throw new Error(`客户 ${code} 配置错误：department_ids 为空`);
  }
  for (const id of departmentIds) {
    if (!DEPARTMENT_FILENAMES[id]) {
      throw new Error(`客户 ${code} 配置错误：department_id ${id} 不在允许列表中（允许：${Object.keys(DEPARTMENT_FILENAMES).join(', ')}）`);
    }
  }

  // price_strategy
  if (!VALID_STRATEGIES.has(row.price_strategy)) {
    throw new Error(`客户 ${code} 配置错误：price_strategy "${row.price_strategy}" 无效，允许值：Class A / Class B / Class C`);
  }

  // brand_blacklist: NULL/空 → []，否则逗号分隔转大写
  const brandBlacklist = row.brand_blacklist
    ? String(row.brand_blacklist).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  // SFTP 认证字段校验
  if (row.sftp_auth_type === 'key' && !row.sftp_key_file) {
    throw new Error(`客户 ${code} 配置错误：sftp_auth_type=key 时 sftp_key_file 必填`);
  }
  if (row.sftp_auth_type === 'password' && !row.sftp_password) {
    throw new Error(`客户 ${code} 配置错误：sftp_auth_type=password 时 sftp_password 必填`);
  }

  return {
    id: row.id,
    customerCode: code,
    customerName: row.customer_name,
    departmentIds,
    priceStrategy: row.price_strategy,
    brandBlacklist,
    sftp: {
      host: row.sftp_host,
      port: row.sftp_port,
      user: row.sftp_user,
      authType: row.sftp_auth_type,
      password: row.sftp_password || null,
      keyFile: row.sftp_key_file || null,
      remoteDir: row.sftp_remote_dir,
    },
    scheduleCron: row.schedule_cron,
  };
}

/** 从 DB 读取所有启用的客户配置并返回结构化数组 */
async function fetchEnabledCustomers() {
  const rows = await query('SELECT * FROM csv_export_customers WHERE is_enabled = 1 ORDER BY id');
  return rows.map(parseCustomer);
}

module.exports = { fetchEnabledCustomers, parseCustomer, DEPARTMENT_FILENAMES };
