# CSV 自动发送服务（csv-export-service）设计文档

- **创建日期**：2026-05-22
- **状态**：v1.0 已确认，可进入实施阶段
- **作者**：与 Claude 协同设计
- **读者**：Claude 开发 Agent（用于后续生成实施计划与代码）
- **GitHub 仓库**：https://github.com/yoxiky/Cypress_CSV_Export

---

## 1. 背景与目标

公司新增一类业务需求：**每 2 小时**通过 **SFTP** 向客户推送一份 CSV 文件，包含该客户对应分公司（department）的商品规格、商品名、库存、价格。

为方便扩展到未来更多客户、未来更多对外服务，本功能**独立成一个新的 Node.js 项目**，与现有的 `procurement-system`（Google Sheet 库存同步）平行部署在同一台阿里云轻量化服务器上，**不混用进程**。

数据库共享：本服务只读取与本功能相关的若干张表（详见第 3 节），并新增一张配置表 `csv_export_customers`。

### 成功标准

1. 每个配置中开启的客户，按各自的 `schedule_cron` 周期，**准时**向对应 SFTP 推送 CSV
2. SFTP 文件内容符合第 3 节定义的字段、过滤和价格规则
3. 失败时**自动重试 3 次**，仍失败则发邮件告警
4. 本地保留 7 天发送历史，便于排查
5. 老系统（procurement-system）的可用性**完全不受影响**

---

## 2. 系统隔离原则

| 维度 | 老系统 `procurement-system` | 新系统 `csv-export-service` |
|---|---|---|
| 代码仓库 | 已有 | 新建独立仓库 |
| Node.js 进程 | PM2 名称 `procurement` | PM2 名称 `csv-export` |
| 配置文件 | 自有 `config.json` | 自有 `config.json` |
| 日志目录 | 自有 `logs/` | 自有 `logs/` |
| MySQL 连接池 | 独立 | 独立 |
| MySQL 账号 | 现有 `tire_readonly`（已具备所需读权限） | **复用同一账号** |
| 故障隔离 | — | 独立进程，老系统崩溃不影响新系统 |
| 部署目录 | `/opt/procurement-system/` | `/opt/csv-export-service/` |

公共模块（如 `logger.js`、`email-notifier.js`）按需**适度复制**（约 100~200 行），不抽取公共包，避免过度工程化。

---

## 3. 业务规则

### 3.1 数据来源（MySQL 表）

| 表名 | 用途 |
|---|---|
| `products` | 商品主表（按部门、品牌、激活状态、库存过滤） |
| `prices` | 商品价格（a_price、promotion_price） |
| `customers` | 客户表（供配置时人工查 `department_id`） |
| `departments` | 分公司表（取 Class B/C 价格的加价/系数；`company_id` 即 `department_id`） |
| `csv_export_customers` | **本服务新建**，CSV 推送配置 |

### 3.2 商品过滤

输出到 CSV 的商品必须**同时**满足：
- `products.is_active = 1`
- `products.total_stock > 0`
- `products.department_id` ∈ 当前客户的 `department_ids` 拆分后的列表
- 若该客户配置了 `brand_blacklist`，**排除**品牌属于黑名单的商品

#### 字段关系说明（`department_ids` vs `products.department_id`）

两个字段名字相似，但来源和用途完全不同：

| 字段 | 所在表 | 来源 | 含义 |
|---|---|---|---|
| `csv_export_customers.department_ids` | 新建配置表 | **管理员手动填写**（用 Navicat） | 此客户要订阅哪些部门的数据，字符串如 `"7"` 或 `"7,10"` |
| `products.department_id` | 已有商品表 | 系统数据 | 此商品**自身**所属部门 |

**过滤逻辑示例**（客户 BIGMART 配置 `department_ids='7,10'`）：

```
1. 程序读取配置：department_ids = '7,10'
2. 拆分成数组：[7, 10]
3. 查询 products，只保留 department_id ∈ [7, 10] 的商品
4. 按部门分组，每个部门生成一份 CSV 文件
   - department_id=7 的商品 → QLD.csv
   - department_id=10 的商品 → NSW.csv
5. 两份 CSV 都上传到该客户的 SFTP
```

### 3.3 品牌提取规则

```
brand = UPPER( trim(products.name) 的第一个空格之前的子串 )
若 trim(products.name) 不含空格，则 brand = "OTHER"
```

匹配黑名单时两边均 `UPPER`，黑名单中的字符串约定大写存储。

> 注意：本规则与老系统 `mysql-reader.js` 中"取 code 前两位"的品牌定义**不同**。两个系统语义独立，互不影响。

### 3.4 CSV 输出列

固定四列、固定顺序、英文表头：

| 列 | 来源 | 备注 |
|---|---|---|
| `size` | `products.helper_code` | 规格 |
| `name` | `products.name` | 商品全名 |
| `stock` | 见 3.5 | 库存（脱敏） |
| `price` | 见 3.6 | 单价 |

CSV 详细格式：
- 编码：**UTF-8 with BOM**（便于客户用 Excel 直接打开）
- 行尾：**CRLF**
- 分隔符：英文逗号 `,`
- 含逗号/换行/引号的字段用双引号包裹，内部双引号转义为 `""`
- 表头行必须存在
- 即使过滤后无任何数据行，也输出**只含表头的空 CSV**

### 3.5 Stock 显示规则

```
if total_stock > 8 → 输出 "8"
else                 → 输出 total_stock 实际数字
```

（已过滤 `=0`，所以最小值为 1。）

### 3.6 Price 计算规则

依据该客户的 `price_strategy`：

#### Class A
```
if products.is_special_offer = 1
   AND prices.promotion_price IS NOT NULL
   AND prices.promotion_price > 0:
    price = prices.promotion_price
else:
    price = prices.a_price
```
若 `prices.a_price` 也缺失或 ≤ 0，则**跳过该商品**，并记录 WARN 日志（以便后续清洗数据）。

#### Class B
```
price = prices.a_price + departments.price_b_increase
```
（按商品所属 department 关联 departments；`departments.company_id = department_id`）

#### Class C
```
price = prices.a_price * departments.price_c_increase
```

> **Class B / Class C 不应用 `promotion_price` 逻辑**——即使 `is_special_offer=1`，B/C 客户仍按上述公式以 `a_price` 为基础计算。

#### 输出格式

**四舍五入到整数**（`Math.round`），无小数点、无千分位分隔符。

| 计算结果 | CSV 中的输出 |
|---|---|
| 189.49 | `189` |
| 189.50 | `190` |
| 189.51 | `190` |
| 1234.40 | `1234` |

---

## 4. 配置表 `csv_export_customers`

### 4.1 表结构

```sql
CREATE TABLE csv_export_customers (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  customer_code   VARCHAR(50)  NOT NULL UNIQUE COMMENT '业务标识，如 BIGMART',
  customer_name   VARCHAR(200) NOT NULL        COMMENT '客户名称（备注用）',
  department_ids  VARCHAR(100) NOT NULL        COMMENT '部门 id 列表，逗号分隔，如 "7" 或 "7,10"',
  price_strategy  VARCHAR(20)  NOT NULL        COMMENT 'Class A / Class B / Class C',
  brand_blacklist VARCHAR(500) NULL            COMMENT 'NULL=不屏蔽；逗号分隔，大写',
  sftp_host       VARCHAR(200) NOT NULL,
  sftp_port       INT          NOT NULL DEFAULT 22,
  sftp_user       VARCHAR(100) NOT NULL,
  sftp_auth_type  ENUM('password','key') NOT NULL,
  sftp_password   VARCHAR(255) NULL            COMMENT '明文密码（与 key 二选一）',
  sftp_key_file   VARCHAR(255) NULL            COMMENT '私钥路径（相对项目根目录）',
  sftp_remote_dir VARCHAR(255) NOT NULL        COMMENT '远程目录，如 /upload/',
  schedule_cron   VARCHAR(50)  NOT NULL DEFAULT '0 */2 * * *',
  is_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### 字段详细说明

| 字段 | 类型 | 必填 | 说明 | 示例值 |
|---|---|---|---|---|
| `id` | INT | 自动 | 主键，自增。Navicat 添加行时不用填，自动生成 | `1`、`2`、`3` |
| `customer_code` | VARCHAR(50) | ✅ | **业务代号**，由管理员自定义的英文短代号；用于日志、归档目录、告警邮件标题。**不对应已有数据库中的任何字段，全新自定义**。必须唯一 | `BIGMART`、`WOOLIES`、`COSTCO` |
| `customer_name` | VARCHAR(200) | ✅ | 客户全名，只作备注用，不参与业务逻辑 | `大客户A`、`Big Mart Pty Ltd` |
| `department_ids` | VARCHAR(100) | ✅ | 此客户要订阅哪些部门的数据。字符串，逗号分隔的部门 id；程序会拆分成数组用于过滤 `products.department_id`。允许的 id：7 (QLD)、8 (GC)、10 (NSW)、15 (VIC) | `7`、`7,10`、`7,8,10,15` |
| `price_strategy` | VARCHAR(20) | ✅ | 价格计算策略，决定如何从 `prices` 表计算单价。**只允许三个值**之一：`Class A`、`Class B`、`Class C` | `Class A` |
| `brand_blacklist` | VARCHAR(500) | ❌ | 屏蔽品牌列表，逗号分隔，**全大写**；该客户不应看到这些品牌的商品。**NULL 或空表示不屏蔽任何品牌** | `KUMHO`、`KUMHO,LINGLONG`、`NULL` |
| `sftp_host` | VARCHAR(200) | ✅ | 客户 SFTP 服务器地址，可填 IP 或域名 | `sftp.bigmart.com`、`120.79.x.x` |
| `sftp_port` | INT | ✅ | SFTP 端口，默认 22 | `22` |
| `sftp_user` | VARCHAR(100) | ✅ | SFTP 登录用户名 | `tiresupplier` |
| `sftp_auth_type` | ENUM | ✅ | SFTP 认证方式，**二选一**：`password`（密码）或 `key`（密钥） | `key` |
| `sftp_password` | VARCHAR(255) | 视情况 | 明文密码。**仅当 `sftp_auth_type='password'` 时必填**，否则留空 | `MyP@ss123` |
| `sftp_key_file` | VARCHAR(255) | 视情况 | SSH 私钥文件路径（相对项目根目录）。**仅当 `sftp_auth_type='key'` 时必填**，否则留空。私钥实际文件需先上传到服务器对应位置 | `./credentials/bigmart_id_rsa` |
| `sftp_remote_dir` | VARCHAR(255) | ✅ | CSV 上传到客户 SFTP 的哪个目录，建议以 `/` 开头和结尾 | `/upload/`、`/incoming/tire/` |
| `schedule_cron` | VARCHAR(50) | ✅ | 推送频率的 cron 表达式（澳大利亚布里斯班时区）。默认每 2 小时一次 | `0 */2 * * *`（每 2 小时）、`0 8,14 * * *`（每天 8 点和 14 点） |
| `is_enabled` | TINYINT(1) | ✅ | 是否启用此客户配置。`1`=启用（参与定时推送），`0`=停用（保留配置但不推送） | `1` |
| `created_at` | DATETIME | 自动 | 记录创建时间，自动填充 | — |
| `updated_at` | DATETIME | 自动 | 记录最后修改时间，自动更新 | — |

> 💡 **修改配置后需重启服务才生效**：`pm2 restart csv-export`。原因见第 6.8 节。

### 4.2 部门 → 文件名映射

写死在代码中（不进 DB，免得有人随意改）：

```js
const DEPARTMENT_FILENAMES = {
  7:  'QLD.csv',  // Brisbane
  8:  'GC.csv',   // Gold Coast
  10: 'NSW.csv',  // Sydney
  15: 'VIC.csv',  // Melbourne
};
```

未在映射中的 `department_id` 视为配置错误，启动时报错。

### 4.3 配置示例

```sql
-- 新增客户 BIGMART：仅 BNE 部门，Class A，屏蔽 KUMHO 品牌
INSERT INTO csv_export_customers
  (customer_code, customer_name, department_ids, price_strategy, brand_blacklist,
   sftp_host, sftp_user, sftp_auth_type, sftp_key_file, sftp_remote_dir, schedule_cron)
VALUES
  ('BIGMART', '大客户A', '7', 'Class A', 'KUMHO',
   'sftp.bigmart.com', 'tiresupplier', 'key', './credentials/bigmart_id_rsa', '/upload/', '0 */2 * * *');

-- 改为发 BNE + Sydney 两份文件
UPDATE csv_export_customers SET department_ids='7,10' WHERE customer_code='BIGMART';

-- 临时停用某客户
UPDATE csv_export_customers SET is_enabled=0 WHERE customer_code='BIGMART';
```

---

## 5. 项目结构

```
csv-export-service/
├── src/
│   ├── index.js              # 入口
│   ├── config.js             # 加载并校验 config.json
│   ├── logger.js             # winston 封装
│   ├── mysql.js              # MySQL 连接池
│   ├── customer-config.js    # 读取 csv_export_customers，解析 list 字段
│   ├── product-fetcher.js    # JOIN products + prices + departments，应用过滤
│   ├── price-calculator.js   # 按 strategy 计算 price
│   ├── csv-builder.js        # 数据数组 → CSV 字符串
│   ├── sftp-uploader.js      # SFTP 上传，原子写入 + 重试
│   ├── archive.js            # 本地归档 + 7 天清理
│   ├── email-notifier.js     # 邮件告警
│   ├── export-job.js         # 单客户单次任务编排
│   └── cron.js               # 从 DB 读配置，注册定时任务
├── sql/
│   └── init.sql              # csv_export_customers 建表语句
├── credentials/              # SSH 私钥们（不入 git）
├── logs/                     # winston 日志
├── archive/                  # 本地归档目录
├── config.json               # 实际配置（不入 git）
├── config.example.json
├── package.json
├── .gitignore
└── README.md
```

---

## 6. 主要模块设计

### 6.1 `customer-config.js`

- 输出函数 `fetchEnabledCustomers()`：从 DB 读取 `is_enabled=1` 的所有配置
- 解析 `department_ids`：`'7,10'` → `[7, 10]`，校验每个 id 在 `DEPARTMENT_FILENAMES` 中
- 解析 `brand_blacklist`：`'KUMHO,LINGLONG'` → `['KUMHO', 'LINGLONG']`；NULL → `[]`
- 校验 `price_strategy` ∈ `{Class A, Class B, Class C}`
- 校验 SFTP 字段完整性（auth_type=key 时 key_file 必填；=password 时 password 必填）

### 6.2 `product-fetcher.js`

输入：`{ departmentId, brandBlacklist }`
输出：商品数组 `[{ helperCode, name, totalStock, isSpecialOffer, aPrice, promotionPrice, departmentId }]`

SQL 草案：
```sql
SELECT
  p.helper_code, p.name, p.total_stock, p.is_special_offer, p.department_id,
  pr.a_price, pr.promotion_price
FROM products p
LEFT JOIN prices pr ON pr.product_id = p.id
WHERE p.is_active = 1
  AND p.total_stock > 0
  AND p.department_id = ?
```

品牌黑名单过滤**放在应用层**（不在 SQL），因为大小写处理 + 提取规则用 SQL 不直观。数据量评估：单部门有效商品 < 5000 条，应用层过滤完全没问题。

`departments.price_b_increase` 与 `price_c_increase` 单独通过 `fetchDepartment(departmentId)` 一次查询取出，传给 `price-calculator`。

### 6.3 `price-calculator.js`

```js
function calculatePrice({ priceStrategy, isSpecialOffer, aPrice, promotionPrice, deptIncrease }) {
  // deptIncrease = { b: number, c: number }
  switch (priceStrategy) {
    case 'Class A': /* 见 3.6 */
    case 'Class B': /* a_price + deptIncrease.b */
    case 'Class C': /* a_price * deptIncrease.c */
    default: throw new Error(...);
  }
}
```

返回 `null` 表示该商品应跳过（如 a_price 缺失）。

### 6.4 `csv-builder.js`

- 输入：行数组 `[{ size, name, stock, price }]`
- 输出：字符串（带 BOM、CRLF、英文表头）
- 转义规则：含 `,`、`"`、`\r`、`\n` 的字段加引号

### 6.5 `sftp-uploader.js`

依赖：`ssh2-sftp-client`

流程：
1. 连接（password 或 key）
2. 把 CSV 内容写到远端 `${remoteDir}/${filename}.tmp`
3. 重命名（覆盖）`.tmp` → `${filename}`，**保证客户端不会读到半成品**
4. 断开
5. 失败重试 3 次，间隔 60 秒；3 次全失败抛出错误供上层处理

### 6.6 `archive.js`

- 写入：`archive/YYYY-MM-DD/{customer_code}/{filename_without_ext}_{HHmm}.csv`
- 清理：每天 04:00（独立 cron）扫描 `archive/`，删除日期 < 今天 - 7 天的目录

### 6.7 `export-job.js`

单个客户的完整流程：
```
async function runExportJob(customerConfig):
  for each departmentId in customerConfig.departments:
    products = product-fetcher.fetch(departmentId, brandBlacklist)
    deptIncrease = product-fetcher.fetchDepartment(departmentId)
    rows = products
      .map(p => buildRow(p, customerConfig.priceStrategy, deptIncrease))
      .filter(r => r !== null)
    csv = csv-builder.build(rows)
    filename = DEPARTMENT_FILENAMES[departmentId]
    archive.save(customerConfig.customerCode, filename, csv)
    await sftp-uploader.upload(customerConfig, filename, csv)   // 含 3 次重试
```

任一 department 失败 → 邮件告警，但**继续处理其它 department**（不让一个部门拖累全部）。

### 6.8 `cron.js`

- 启动时调用 `fetchEnabledCustomers()`，对每个客户的 `schedule_cron` 调 `cron.schedule(...)`
- 每个 cron 触发时 `runExportJob(customer)`
- 时区：`Australia/Brisbane`（沿用老系统）
- 额外注册一个清理 job：`0 4 * * *` 调 `archive.cleanup()`
- **配置改动需要重启服务**才生效（PM2 `pm2 restart csv-export`）

---

## 7. 调度策略

- 默认 cron：`0 */2 * * *`（00:00、02:00、04:00 ... 22:00，按澳大利亚布里斯班时区）
- 24/7 运行，无窗口限制
- 同一时刻多客户被触发时**并行**（每个客户是独立的 Promise）
- 单客户内部多部门**串行**（避免对同一 SFTP 主机过载）

---

## 8. 错误处理与告警

| 场景 | 处理 |
|---|---|
| MySQL 查询失败 | 重试整个 job 共 3 次（间隔 60s）→ 仍失败发邮件 |
| SFTP 连接/上传失败 | 在 sftp-uploader 内重试 3 次 → 抛出 → 上层发邮件 |
| 单条商品价格计算失败（a_price 缺失） | WARN 日志，跳过该商品，不告警 |
| 配置无效（部门不在映射、strategy 非法等） | 启动时即报错退出 |
| 单 department 失败 | 不影响同客户其它 department；发邮件后继续 |

告警邮件：
- 收件人：`config.json` 中 `email.to`（单一列表，不区分客户）
- 主题：`[CSV Export] 客户 {customer_code} 部门 {dept} 推送失败`
- 正文：时间戳 + 错误堆栈 + 客户信息

---

## 9. 本地归档

- 路径模板：`archive/YYYY-MM-DD/{customer_code}/{stateCode}_{HHmm}.csv`
  例：`archive/2026-05-22/BIGMART/QLD_1400.csv`
- 保留 7 天，每天 04:00 清理
- 与日志独立（日志只保留事件，归档保留实际文件内容）

---

## 10. `config.json` 结构

```json
{
  "mysql": {
    "host": "数据库内网 IP",
    "port": 33066,
    "user": "tire_readonly",
    "password": "",
    "database": ""
  },
  "email": {
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "user": "your@gmail.com",
      "pass": "Gmail App Password"
    },
    "from": "CSV Export <your@gmail.com>",
    "to": ["csv-ops@yourcompany.com"]
  },
  "timezone": "Australia/Brisbane",
  "archive_retention_days": 7,
  "log_retention_days": 14
}
```

注意：**客户级配置不在这里**，全部在 MySQL 的 `csv_export_customers` 表里。

---

## 11. 部署

```bash
# 在阿里云服务器
cd /opt
git clone <repo> csv-export-service
cd csv-export-service
npm install
cp config.example.json config.json
vim config.json                          # 填好 MySQL / 邮件
# 上传 SFTP 私钥到 credentials/
mysql ... < sql/init.sql                  # 建配置表
mysql ... # 用 INSERT 语句加客户配置
pm2 start src/index.js --name csv-export
pm2 save
```

PM2 共存视图：
```
$ pm2 list
┌─────┬──────────────────┬─────────┐
│ id  │ name             │ status  │
├─────┼──────────────────┼─────────┤
│ 0   │ procurement      │ online  │
│ 1   │ csv-export       │ online  │
└─────┴──────────────────┴─────────┘
```

---

## 12. 本地开发约束

按 `CLAUDE.md`，本地无法直连 MySQL。因此：

- 所有 MySQL 相关代码**只能在服务器上集成测试**
- 单元测试覆盖纯逻辑部分（价格计算、CSV 生成、品牌提取、配置解析），用 mock 数据
- **SFTP 测试推荐方案**（无需本地装 Docker）：
  - **方案 A（推荐，最简单）**：直接用阿里云服务器自身做"假客户"。服务器本来就有 SSH/SFTP（22 端口）。在服务器上 `mkdir /home/sftp-test`，然后在 `csv_export_customers` 中配置一条测试记录，把 `sftp_host` 填 `127.0.0.1`、`sftp_user` 填 `root`、`sftp_auth_type` 填 `key`、`sftp_key_file` 指向服务器上现成的私钥、`sftp_remote_dir` 填 `/home/sftp-test`。服务给"自己"传文件，验证完整链路。
  - **方案 B**：如客户提供测试 SFTP，直接用客户的
  - **方案 C（仅在 A/B 都不可行时）**：本地用 Docker 起 `atmoz/sftp`
- 端到端：在服务器上 `pm2 start --no-daemon` 干跑，看日志确认，OK 后再 daemon 化

---

## 13. 实施计划（分阶段）

每个阶段都有可独立验证的产出。建议按顺序执行。

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| **S1** | 项目骨架、依赖、`logger`、`config`、`mysql` 连接池 | 服务器上 `node src/index.js` 能启动并连上 MySQL |
| **S2** | 建表 SQL、`customer-config.js`、字段解析 | 单测：用 mock 验证逗号字段解析；服务器：能列出 DB 中配置 |
| **S3** | `product-fetcher.js`、`price-calculator.js`、品牌提取（含 OTHER） | 单测：覆盖 Class A/B/C、is_special_offer 各种组合、品牌边界 |
| **S4** | `csv-builder.js`（BOM、CRLF、转义、空表头） | 单测：对比预期 CSV 字节序列 |
| **S5** | `sftp-uploader.js`（原子写、3 次重试） | 本地 Docker SFTP 跑通；故意断网测试重试 |
| **S6** | `archive.js`（保存 + 7 天清理） | 手动跑、检查目录结构；手动改文件日期测试清理 |
| **S7** | `export-job.js` 端到端串联 | 在测试客户上跑一次完整任务，SFTP 收到、本地归档正确 |
| **S8** | `cron.js`、`email-notifier.js`、`index.js`，告警链路 | 改 cron 为 `* * * * *` 验证；故意配错 SFTP 密码验证告警邮件到达 |
| **S9** | 部署到生产、加真实客户配置 | 至少观察 2 个 2 小时周期，客户确认收到 |

---

## 14. 测试策略

- **单元测试**（`node --test`）：
  - `price-calculator`：覆盖 3 种 strategy × is_special_offer × promotion_price 缺失/非空 的组合矩阵
  - `csv-builder`：表头、单行、多行、含特殊字符的字段、空数据集
  - `customer-config`：合法/非法的 department_ids、brand_blacklist、strategy
  - 品牌提取：含空格、不含空格、首尾空格、纯空格、空字符串
- **集成测试**：服务器 + 测试 SFTP
- **生产前演练**：用客户提供的开发/测试 SFTP 跑 24 小时

---

## 15. 不在本期范围（YAGNI）

以下功能**有意不做**，等真有需求再加：
- 任何 Web 界面 / 管理后台
- 客户自助 API（让客户主动拉数据）
- 多 SFTP 凭证轮换 / 自动密钥更新
- CSV 格式可配置化（不同客户不同列）——目前固定 4 列即可
- 数据库写权限（本服务全程只读 + 一次性 INSERT 配置）
- 历史归档到对象存储（OSS）——本地 7 天足够

---

## 16. 风险与缓解

| 风险 | 缓解 |
|---|---|
| MySQL 慢查询拖累客户推送 | 单部门查询 < 5000 行，SQL 走 `is_active + department_id` 索引；超时设 30s |
| SFTP 客户端在客户那边凌晨维护 | 重试 3 次失败邮件告警，运维人工跟进；不引入额外窗口配置（YAGNI） |
| 配置表里 SFTP 密码明文 | 现阶段接受（账号是 `tire_readonly`，泄漏面有限）；如未来要加密，加一层环境变量主密钥 |
| 老系统改动影响共享数据库 | 二者**都只读**，无写冲突；连接池各自独立，无连接数干扰 |
| 服务器宕机错过推送窗口 | 现阶段接受；如客户要求 SLA，可在另一台服务器做主备 |

---

文档结束。可作为 S1~S9 阶段实施的输入。
