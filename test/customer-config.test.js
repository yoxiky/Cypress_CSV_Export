// 单元测试：parseCustomer 纯函数，无需 DB 连接
// 运行：node --test test/customer-config.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomer } = require('../src/customer-config');

// 合法的基础行，各测试在此基础上覆盖需要的字段
function baseRow(overrides = {}) {
  return {
    id: 1,
    customer_code: 'TESTCO',
    customer_name: 'Test Co',
    department_ids: '7',
    price_strategy: 'Class A',
    brand_blacklist: null,
    sftp_host: 'sftp.example.com',
    sftp_port: 22,
    sftp_user: 'user',
    sftp_auth_type: 'password',
    sftp_password: 'pass123',
    sftp_key_file: null,
    sftp_remote_dir: '/upload/',
    schedule_cron: '0 */2 * * *',
    ...overrides,
  };
}

// ── 正常解析 ──────────────────────────────────────────────────────────────────

test('基本解析：单部门、Class A、密码认证', () => {
  const r = parseCustomer(baseRow());
  assert.deepEqual(r.departmentIds, [7]);
  assert.equal(r.priceStrategy, 'Class A');
  assert.deepEqual(r.brandBlacklist, []);
  assert.equal(r.sftp.authType, 'password');
  assert.equal(r.sftp.password, 'pass123');
  assert.equal(r.sftp.keyFile, null);
});

test('多部门 department_ids 解析', () => {
  const r = parseCustomer(baseRow({ department_ids: '7,10,15' }));
  assert.deepEqual(r.departmentIds, [7, 10, 15]);
});

test('department_ids 前后空格被 trim', () => {
  const r = parseCustomer(baseRow({ department_ids: ' 7 , 10 ' }));
  assert.deepEqual(r.departmentIds, [7, 10]);
});

test('Class B 策略解析正常', () => {
  const r = parseCustomer(baseRow({ price_strategy: 'Class B' }));
  assert.equal(r.priceStrategy, 'Class B');
});

test('Class C 策略解析正常', () => {
  const r = parseCustomer(baseRow({ price_strategy: 'Class C' }));
  assert.equal(r.priceStrategy, 'Class C');
});

test('brand_blacklist 逗号分隔 + 自动转大写 + trim', () => {
  const r = parseCustomer(baseRow({ brand_blacklist: 'kumho, Linglong , drc' }));
  assert.deepEqual(r.brandBlacklist, ['KUMHO', 'LINGLONG', 'DRC']);
});

test('brand_blacklist 为 null 返回空数组', () => {
  assert.deepEqual(parseCustomer(baseRow({ brand_blacklist: null })).brandBlacklist, []);
});

test('brand_blacklist 为空字符串返回空数组', () => {
  assert.deepEqual(parseCustomer(baseRow({ brand_blacklist: '' })).brandBlacklist, []);
});

test('sftp_auth_type=key 有 key_file 解析正常', () => {
  const r = parseCustomer(baseRow({
    sftp_auth_type: 'key',
    sftp_key_file: './credentials/test_rsa',
    sftp_password: null,
  }));
  assert.equal(r.sftp.keyFile, './credentials/test_rsa');
  assert.equal(r.sftp.password, null);
});

// ── 校验失败 ──────────────────────────────────────────────────────────────────

test('department_ids 为空字符串抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ department_ids: '' })),
    /department_ids 为空/
  );
});

test('department_ids 含非法 id 抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ department_ids: '99' })),
    /department_id 99 不在允许列表/
  );
});

test('合法与非法 id 混合时仍抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ department_ids: '7,99' })),
    /department_id 99/
  );
});

test('非法 price_strategy 抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ price_strategy: 'Class D' })),
    /price_strategy/
  );
});

test('sftp_auth_type=key 缺 key_file 抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ sftp_auth_type: 'key', sftp_key_file: null, sftp_password: null })),
    /sftp_key_file 必填/
  );
});

test('sftp_auth_type=password 缺 password 抛错', () => {
  assert.throws(
    () => parseCustomer(baseRow({ sftp_auth_type: 'password', sftp_password: '' })),
    /sftp_password 必填/
  );
});
