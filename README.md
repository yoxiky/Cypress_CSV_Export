# Cypress CSV Export Service

每 2 小时通过 **SFTP** 向客户推送一份 CSV 文件，包含对应分公司（department）的商品规格、商品名、库存、价格。

与现有的 [`procurement-system`](https://github.com/yoxiky/procurement)（Google Sheet 库存同步）平行部署在同一台阿里云服务器上，**独立进程、独立配置、独立日志**，互不影响。

---

## 功能概览

- 多客户配置驱动：所有客户配置集中在 MySQL 的 `csv_export_customers` 表中
- 每 2 小时（cron 可配）按部门生成 CSV，上传到客户的 SFTP
- 三种价格策略：Class A（含特价逻辑）、Class B（加价）、Class C（系数）
- 品牌黑名单：按客户屏蔽指定品牌
- 失败自动重试 3 次，仍失败发邮件告警
- 本地归档 7 天，便于排查

详细设计见 [`docs/design.md`](./docs/design.md)。

---

## 快速开始

```bash
# 在服务器上
cd /opt
git clone https://github.com/yoxiky/Cypress_CSV_Export.git csv-export-service
cd csv-export-service
npm install
cp config.example.json config.json
vim config.json                        # 填写 MySQL、邮件配置

# 上传 SFTP 私钥到 credentials/
mysql -u ... -p ... < sql/init.sql     # 建配置表
# 用 INSERT 语句添加客户配置（见 docs/design.md 第 4.3 节）

pm2 start src/index.js --name csv-export
pm2 save
```

---

## 项目结构

```
Cypress_CSV_Export/
├── docs/
│   └── design.md            # 设计文档
├── src/                     # 源代码（待实施）
├── sql/                     # 数据库脚本
├── credentials/             # SSH 私钥（不入 git）
├── logs/                    # 运行日志（不入 git）
├── archive/                 # 本地归档（不入 git）
├── config.json              # 实际配置（不入 git）
├── config.example.json      # 配置模板
└── package.json
```

---

## 配置查看 / 修改

所有客户级配置都在 MySQL 的 `csv_export_customers` 表里，**用 Navicat 直接增删改即可**。

修改配置后需要重启服务才生效：

```bash
pm2 restart csv-export
```

---

## 相关文档

- [设计文档](./docs/design.md)
- [姊妹项目：procurement-system](https://github.com/yoxiky/procurement)
