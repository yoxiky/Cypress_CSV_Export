# Cypress CSV Export — 开发计划（供 Claude Agent 执行）

> 业务规则的权威文档是 [`design.md`](./design.md)。本文件只描述**实施顺序、交付物清单、验证方法**。两份文件冲突时以 `design.md` 为准。

---

## 总体原则

1. **每个阶段独立可验证**。不要把多个阶段的代码混在一起 commit
2. **每完成一个阶段 → commit → 停下来等用户确认**，不要连跑多个阶段
3. **MySQL 相关代码必须先在服务器上集成测试通过**，再合并到 main
4. **保持简单**：不要写未被要求的功能（YAGNI 原则）。`design.md` 第 15 节列出了**有意不做**的东西

---

## 阶段总览

| 阶段 | 主题 | 是否需要 MySQL | 是否需要 SFTP |
|---|---|---|---|
| **S1** | 项目骨架（logger / config / mysql 连接池 / index 入口） | ✅ | ❌ |
| **S2** | 建表 SQL + 配置读取与解析 | ✅ | ❌ |
| **S3** | 商品查询 + 价格计算 + 品牌提取 | ✅ | ❌ |
| **S4** | CSV 生成（BOM、CRLF、转义） | ❌ | ❌ |
| **S5** | SFTP 上传（原子写、3 次重试） | ❌ | ✅ |
| **S6** | 本地归档（保存 + 7 天清理） | ❌ | ❌ |
| **S7** | 端到端单客户 job 串联 | ✅ | ✅ |
| **S8** | cron 调度 + 邮件告警 + 完整 index | ✅ | ✅ |
| **S9** | 生产部署 + 接真实客户 | ✅ | ✅ |

---

## S1 — 项目骨架

### 目标
能在服务器上 `node src/index.js` 启动，加载配置、初始化日志、成功连接到 MySQL（执行 `SELECT 1`），然后退出。

### 交付物
- `config.example.json` — 配置模板
- `src/config.js` — 加载 / 校验 / 导出 config
- `src/logger.js` — winston 封装（控制台 + 按日轮转文件）
- `src/mysql.js` — `mysql2/promise` 连接池，导出 `query()` 和 `testConnection()`
- `src/index.js` — 入口，按顺序：load config → init logger → test MySQL → log "started"

### 实现要点
- `winston-daily-rotate-file`，日志路径 `logs/YYYY-MM-DD.log`，保留 14 天
- 必填字段缺失时 `config.js` 直接 `throw`，不要 fallback 到默认值（防止配置错误悄悄上线）
- MySQL 连接池：`connectionLimit: 10`，包含 `timezone: '+10:00'`（布里斯班）
- `index.js` 不启动任何 cron 或 HTTP 服务，本阶段只验证基础设施

### 验证
1. 本地：`node src/index.js` 应在加载 MySQL 时报错（本地无法连，预期行为）
2. 服务器：上传后运行，看到日志 `MySQL 连接测试成功` 和 `service started`
3. `logs/2026-XX-XX.log` 文件被创建

---

## S2 — 建表 SQL + 客户配置读取

### 目标
能从 MySQL 的 `csv_export_customers` 表读取所有 `is_enabled=1` 的客户配置，解析逗号分隔字段，校验合法性。

### 交付物
- `sql/init.sql` — `CREATE TABLE csv_export_customers ...`（来自 `design.md` 4.1 节）
- `src/customer-config.js` — 导出 `fetchEnabledCustomers()`
- 单元测试：`test/customer-config.test.js`

### 实现要点
- `DEPARTMENT_FILENAMES` 常量写死在 `customer-config.js` 中（见 `design.md` 4.2 节）
- 解析逻辑：
  - `department_ids: '7,10'` → `[7, 10]`，每个 id 必须在 `DEPARTMENT_FILENAMES` 中，否则抛错
  - `brand_blacklist: 'KUMHO,LINGLONG'` → `['KUMHO', 'LINGLONG']`；NULL/空 → `[]`
  - `price_strategy` 必须是 `Class A`、`Class B`、`Class C` 之一
  - `sftp_auth_type='key'` 时 `sftp_key_file` 必填；`='password'` 时 `sftp_password` 必填
- 任何校验失败 → 抛 `Error('客户 X 配置错误：Y')`，让上层处理（一个客户出错不影响其它客户）

### 验证
1. 本地单测覆盖：合法、各种非法字段、边界值（空字符串、纯空格、前后空格）
2. 服务器：插入一两条测试数据，跑 `node -e "require('./src/customer-config').fetchEnabledCustomers().then(console.log)"`

---

## S3 — 商品查询 + 价格计算 + 品牌提取

### 目标
给定 `(departmentId, brandBlacklist)`，能输出过滤后的 `[{ size, name, stock, price }]` 数组。

### 交付物
- `src/product-fetcher.js` — `fetchProducts(departmentId)` 和 `fetchDepartment(departmentId)`
- `src/price-calculator.js` — `calculatePrice({...})`
- `src/brand-extractor.js` — `extractBrand(name)`
- 单测：`test/price-calculator.test.js`、`test/brand-extractor.test.js`

### 实现要点
- 品牌提取规则（`design.md` 3.3 节）：
  ```
  name.trim() 的第一个空格之前的子串，UPPER；不含空格 → 'OTHER'
  ```
- 价格计算（`design.md` 3.6 节）：
  - **Class A**：`is_special_offer=1 AND promotion_price>0` → 用 `promotion_price`，否则 `a_price`
  - **Class B**：`a_price + price_b_increase`
  - **Class C**：`a_price * price_c_increase`
  - 计算失败（`a_price` 缺失或 ≤ 0）→ 返回 `null`，上层跳过该商品并打 WARN
  - **B/C 不应用 promotion_price 逻辑**
- 价格输出：`Math.round()`，整数
- Stock 显示：`> 8 → 8`，否则原值
- 品牌黑名单过滤**放应用层**（取出全部后再 filter）

### 验证
1. 单测覆盖矩阵：3 种策略 × is_special_offer 真假 × promotion_price 缺/有 = 12+ 组合
2. 服务器：跑 `fetchProducts(7)`，至少有 100+ 条返回，抽查几条价格手动核对

---

## S4 — CSV 生成

### 目标
给定 `[{ size, name, stock, price }]`，输出 UTF-8 BOM + CRLF + 正确转义的 CSV 字符串。

### 交付物
- `src/csv-builder.js` — `build(rows)` 返回字符串
- 单测：`test/csv-builder.test.js`

### 实现要点
- BOM：`﻿` 开头
- 行尾：`\r\n`
- 表头固定：`size,name,stock,price`
- 转义：含 `,`、`"`、`\r`、`\n` 的字段加引号；内部引号 `"` → `""`
- 空 rows：仍输出表头行

### 验证
- 单测：表头、单行、多行、含逗号、含引号、含换行、空集合
- 在 Excel 中打开生成的 .csv 文件，中文不乱码、列对齐

---

## S5 — SFTP 上传（原子写 + 3 次重试）

### 目标
能上传一段 CSV 内容到指定 SFTP，失败重试 3 次。

### 交付物
- `src/sftp-uploader.js` — `upload({ customerConfig, filename, content })`

### 实现要点
- 依赖：`ssh2-sftp-client`
- 流程：
  1. 连接（password 或 key 两种认证）
  2. 写入 `${remoteDir}/${filename}.tmp`
  3. `rename` 覆盖原 `${filename}` —— **保证客户不会看到半成品**
  4. 断开
- 重试 3 次，间隔 60 秒
- 3 次全失败 → 抛出 Error（上层处理告警）

### 验证（推荐"服务器自身做 SFTP"方案）
1. 服务器上 `mkdir /home/sftp-test`
2. 临时插入一条测试客户配置，`sftp_host=127.0.0.1`、`sftp_user=root`、`sftp_key_file=<服务器现成私钥>`、`sftp_remote_dir=/home/sftp-test`
3. 跑 upload，检查 `/home/sftp-test/` 是否出现文件
4. 故意把密码写错，验证 3 次重试 + 抛错

---

## S6 — 本地归档

### 目标
每次推送同时把 CSV 内容存到本地 `archive/`，并每天 04:00 清理 7 天前的目录。

### 交付物
- `src/archive.js` — `save(customerCode, filename, content)` 和 `cleanup()`

### 实现要点
- 路径模板：`archive/YYYY-MM-DD/{customer_code}/{filenameWithoutExt}_{HHmm}.csv`
- 例：`archive/2026-05-22/BIGMART/QLD_1400.csv`
- 清理：扫描 `archive/`，删除日期 < `今天 - retention_days`（默认 7）的目录
- 使用 `fs/promises`，注意目录不存在时 `mkdir { recursive: true }`

### 验证
- 手动跑 save，检查目录结构正确
- 手动建几个旧日期目录（如 `archive/2020-01-01/`），跑 cleanup，确认被删

---

## S7 — 端到端单客户任务串联

### 目标
对一个客户配置，能完成「读配置 → 查商品 → 算价 → 生成 CSV → 归档 → SFTP 上传」的完整流程。

### 交付物
- `src/export-job.js` — `runExportJob(customerConfig)`

### 实现要点
- 一个客户内多个 department **串行**执行（避免对同一 SFTP 主机过载）
- 任一 department 失败 → log error，但**继续处理其它 department**
- 失败错误返回上层（cron / index 决定是否告警）

### 验证
- 服务器上手动调用 `runExportJob`，传入测试客户配置
- 检查：`/home/sftp-test/` 有文件、`archive/` 有归档、日志正常

---

## S8 — cron 调度 + 邮件告警 + 完整入口

### 目标
服务以 PM2 启动后，按 `csv_export_customers.schedule_cron` 自动定时执行每个客户。失败时发邮件。

### 交付物
- `src/email-notifier.js` — `sendAlert(subject, body)`
- `src/cron.js` — 启动时读取所有 enabled 客户，注册 cron task；额外注册一个 `0 4 * * *` 调 `archive.cleanup()`
- `src/index.js` — 更新为完整启动流程（加载配置 → init logger → 测试 MySQL → 启动 cron）

### 实现要点
- 时区：`Australia/Brisbane`
- 多客户**并行**触发（每个客户是独立 Promise）
- 单客户内部 department **串行**
- 失败邮件主题：`[CSV Export] 客户 {customer_code} 部门 {dept} 推送失败`

### 验证
- 服务器：把 cron 临时改 `* * * * *`（每分钟），观察执行日志和邮件
- 故意把 SFTP 密码写错，验证 3 次重试 + 邮件告警链路完整

---

## S9 — 生产部署

### 目标
上线，接真实客户。

### 交付物
- 部署脚本或文档（手动 ssh 也行）
- 真实客户 `csv_export_customers` 记录

### 步骤
1. 服务器 `git clone` 到 `/opt/csv-export-service/`
2. `npm install`
3. 上传 `config.json` 和 SFTP 私钥到 `credentials/`
4. 跑 `sql/init.sql` 建表
5. 用 Navicat 插入真实客户配置
6. `pm2 start src/index.js --name csv-export && pm2 save`
7. **连续观察 2 个 2 小时周期**，与客户确认收到文件且内容正确

---

## 当前进度

- [x] 仓库初始化（README、.gitignore、package.json、docs/design.md）
- [x] S1 — 项目骨架（MySQL 连接验证通过）
- [x] S2 — 建表 SQL + 客户配置读取（15 单测全过，DB 集成验证通过）
- [x] S3 — 商品查询 + 价格计算 + 品牌提取（20 单测全过，DB 集成 QLD 1127 条通过）
- [x] S4 — CSV 生成（12 单测全过）
- [x] S5 — SFTP 上传（服务器自身 SFTP 测试通过，重试链路验证通过）
- [x] S6 — 本地归档（save/cleanup 服务器验证通过，旧目录清理正确）
- [x] S7 — 端到端串联（QLD 1125 条商品，SFTP 上传 + 归档全部通过）
- [x] S8 — cron 调度 + 邮件告警（PM2 启动正常，两个服务并存，cron 已注册）
- [ ] S9 — 生产部署（接真实客户）← 下一步

每完成一阶段，在这里勾选并 commit。
