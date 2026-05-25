# CLAUDE.md — Cypress CSV Export Service

读 Claude Agent 在本仓库工作前必读。

---

## 一、项目目标

每 2 小时（cron 可配）通过 **SFTP** 向客户推送 CSV 文件，包含对应分公司（department）的商品规格、商品名、库存、价格。

- **业务规则的唯一权威来源**：`docs/design.md`
- **分阶段实施计划**：`docs/development-plan.md`
- **GitHub**：https://github.com/yoxiky/Cypress_CSV_Export

---

## 二、关键约束

### 1. 本地无法连接 MySQL

所有 MySQL 相关代码**只能在服务器（47.237.82.241）上集成测试**。本地仅做：
- 单元测试（mock 数据）
- 代码编写与代码审查

服务器登录方式：
```bash
ssh -i "<本地私钥路径>" root@47.237.82.241
```

服务器部署目录：`/opt/csv-export-service/`
PM2 进程名：`csv-export`

### 2. 与 procurement-system 严格隔离

老项目 `procurement-system` 与本项目共用同一台服务器、同一个 MySQL 实例，但：
- 各自独立 PM2 进程，互不影响
- 各自独立 `config.json`、`logs/`、`archive/`
- 老项目崩溃必须不能影响本项目

### 3. 数据库只读 + 一次性写

本服务对 MySQL 是**只读**操作（读取 `products`、`prices`、`departments`、`csv_export_customers`）。

唯一一次写入操作：在部署阶段创建 `csv_export_customers` 表（`sql/init.sql`），之后所有配置由人工用 Navicat 维护。

---

## 三、代码哲学

### 简单优先

- 用最少的代码解决问题，不预设未来需求
- 不为单次使用的代码做抽象
- 不引入未被要求的"灵活性"
- 写完一段代码，问自己：senior engineer 会不会觉得过度设计？如果会，重写

### 外科手术式修改

- 只动需要动的地方，不顺手"改进"无关代码
- 不重构没坏的东西
- 跟随已有代码风格，即使不符合你的偏好
- 看到无关 dead code，**提出来但不删**

### 目标驱动 + 验证

每个改动都必须有明确的验证方式。模糊的"让它跑起来"等于没有标准。

---

## 四、常用命令速查

```bash
# 本地代码推送
cd "D:\Vibe Coding\Order System\Cypress_CSV_Export"
git add .
git commit -m "..."
git push

# 服务器部署 / 重启
ssh -i <key> root@47.237.82.241
cd /opt/csv-export-service
git pull
npm install                     # 仅依赖变化时
pm2 restart csv-export

# 看日志
pm2 logs csv-export --lines 100
tail -f /opt/csv-export-service/logs/$(date +%Y-%m-%d).log
```

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
