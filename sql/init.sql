-- csv_export_customers 配置表
-- 在 Navicat 中选中 iwe 数据库后执行
-- 执行一次即可，之后用 INSERT/UPDATE 维护客户配置

CREATE TABLE IF NOT EXISTS csv_export_customers (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  customer_code   VARCHAR(50)   NOT NULL UNIQUE  COMMENT '业务代号，管理员自定义英文短代码，如 BIGMART。用于日志、归档目录、告警邮件标题',
  customer_name   VARCHAR(200)  NOT NULL          COMMENT '客户全名，仅备注用，不参与业务逻辑',
  department_ids  VARCHAR(100)  NOT NULL          COMMENT '订阅的部门 id，逗号分隔。允许值：7=QLD, 8=GC, 10=NSW, 15=VIC。例：单部门填 "7"，多部门填 "7,10"',
  price_strategy  VARCHAR(20)   NOT NULL          COMMENT '价格策略，只允许三个值之一：Class A / Class B / Class C',
  brand_blacklist VARCHAR(500)  NULL              COMMENT '屏蔽品牌列表，逗号分隔，全大写。NULL 或空表示不屏蔽。例：KUMHO 或 KUMHO,LINGLONG',
  sftp_host       VARCHAR(200)  NOT NULL          COMMENT 'SFTP 服务器地址，可填 IP 或域名',
  sftp_port       INT           NOT NULL DEFAULT 22 COMMENT 'SFTP 端口，默认 22',
  sftp_user       VARCHAR(100)  NOT NULL          COMMENT 'SFTP 登录用户名',
  sftp_auth_type  ENUM('password','key') NOT NULL COMMENT '认证方式：password（密码）或 key（SSH 私钥）',
  sftp_password   VARCHAR(255)  NULL              COMMENT '明文密码。仅 sftp_auth_type=password 时填写，否则留空',
  sftp_key_file   VARCHAR(255)  NULL              COMMENT '私钥文件路径（相对项目根目录）。仅 sftp_auth_type=key 时填写，否则留空。例：./credentials/bigmart_id_rsa',
  sftp_remote_dir VARCHAR(255)  NOT NULL          COMMENT 'CSV 上传到客户 SFTP 的目录，建议以 / 开头和结尾。例：/upload/',
  schedule_cron   VARCHAR(50)   NOT NULL DEFAULT '0 */2 * * *' COMMENT '推送频率 cron（布里斯班时区）。默认每 2 小时一次。例：每天 8 点和 14 点填 "0 8,14 * * *"',
  is_enabled      TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '是否启用：1=启用（参与定时推送），0=停用（保留配置但不推送）',
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
