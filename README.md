# RNGdle Automation

一个自托管的 RNGdle 每日自动化服务：在 UTC+8 `08:02` 执行当天 roll，读取数字、EP、Lifetime EP 和 badges，并通过通用 SMTP 发送结果邮件。

![RNGdle Control](docs/control-page.png)

## 功能

- Docker Compose 常驻运行，默认时区为 `Asia/Shanghai`
- Playwright 持久化登录，会话失效时通过 Control 页面重新认证
- 当天任务幂等执行，失败后按配置间隔重试，默认每 30 分钟一次
- RNGdle 风格 HTML 邮件和纯文本邮件
- 本地 Control 页面：Overview、Logs、Authentication、Settings
- 数据、浏览器会话和运行日志保存于 Docker named volume

## 快速开始

### 1. 配置

```bash
cp .env.example .env
cp config/config.example.yaml config/config.yaml
```

在 `.env` 中填写 RNGdle 邮箱和 SMTP 凭证。常用配置如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TZ` | `Asia/Shanghai` | 调度时区 |
| `SCHEDULE_TIME` | `08:02` | 每日执行时间 |
| `RETRY_MINUTES` | `30` | RNGdle roll 失败重试间隔 |
| `EMAIL_RETRY_MINUTES` | `1` | 邮件发送失败重试间隔（兼容旧变量 `MAIL_RETRY_MINUTES`） |
| `RNGDLE_EMAIL` | 必填 | RNGdle 登录邮箱 |
| `SMTP_HOST` | - | SMTP 主机 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | `true` 表示 implicit TLS（通常为 465） |
| `SMTP_REQUIRE_TLS` | `true` | 是否要求 STARTTLS |
| `SMTP_AUTH_MODE` | `password` | `password` 或 `oauth2` |
| `SMTP_USER` | - | SMTP 用户名 |
| `SMTP_PASSWORD` | - | SMTP 密码或应用专用密码 |
| `MAIL_FROM` | - | 发件地址 |
| `MAIL_TO` | - | 收件地址 |
| `MAIL_FROM_NAME` | `RNGdle Today` | 发件人显示名称 |

OAuth2 还需要 `SMTP_OAUTH_CLIENT_ID`、`SMTP_OAUTH_CLIENT_SECRET`、`SMTP_OAUTH_REFRESH_TOKEN` 和 `SMTP_OAUTH_ACCESS_URL`。完整配置见 [`config/config.example.yaml`](config/config.example.yaml)。

### 2. 启动

```bash
docker compose up -d rngdle
docker compose logs -f rngdle
```

打开 [http://localhost:3000](http://localhost:3000)。Control 默认只绑定本机地址。

### 3. 首次登录

1. 在 Overview 或 Authentication 页面点击 **Request sign-in link**，进入官方 RNGdle 登录页。
2. 完成邮箱填写和 Cloudflare Turnstile，接收 RNGdle 发来的 magic link。
3. 将完整的 `https://www.rngdle.com/...` 链接粘贴到 Authentication 页面并提交。
4. 等待状态变为 **Authenticated**，服务会保存 Playwright 浏览器会话。

验证码和 Turnstile 由官方页面处理；Control 不会代发绕过验证的登录请求。登录失效时，服务会在页面和邮件中提示重新认证。

![Authentication](docs/control-auth.png)

## Control 页面

- **Overview**：查看服务状态、最近一次结果和下次调度；右侧可直接 **Send email** 或 **Open preview**。
- **Logs**：查看结构化运行日志和筛选结果。
- **Authentication**：输入 magic link、查看认证状态和会话时间。
- **Settings**：分别修改 RNGdle roll 重试、邮件重试、调度和 SMTP 配置。保存后写入数据卷并立即作为运行时覆盖；空白 SMTP 密码会保留当前密码。

邮件预览使用与实际发送相同的数据和模板：

![Email result](docs/email-result.png)

邮件会显示当天数字、稀有度、EP、Lifetime EP 和 badges。稀有度阈值遵循 RNGdle：Common、Uncommon、Rare、Epic、Anomaly、Mythic。

## 调度与重试

服务启动后会检查当天本地状态：

1. 当天已经成功 roll 且邮件已发送，直接跳过。
2. 已有当天 roll 会直接复用，不会重新生成数字。
3. RNGdle roll 未完成或失败，按 `RETRY_MINUTES` 重试；默认每 30 分钟一次。
4. 邮件发送失败只重试投递，按 `EMAIL_RETRY_MINUTES` 重试；默认每 1 分钟一次。
5. 浏览器会话失效时暂停任务，完成 Authentication 后自动恢复。

需要手动立即执行时，先停止常驻服务，再使用 `once` profile（两者共享端口和浏览器数据）：

```bash
docker compose stop rngdle
docker compose --profile tools run --rm --service-ports once
docker compose start rngdle
```

## 常用运维

```bash
docker compose ps
docker compose logs -f rngdle
docker compose restart rngdle
docker compose down
```

`docker compose down` 不会删除 named volume。以下命令会同时删除登录会话、历史状态和设置，请谨慎使用：

```bash
docker compose down -v
```

主要数据位于 `rngdle_automation_rngdle-data`：

- `browser-profile/`：Playwright persistent context 和 cookies
- `state.json`：每日结果、邮件状态和重试记录
- `settings.json`：Control 页面保存的运行时配置
- `workflow.lock`：任务互斥锁

备份该 volume 前请确认其中包含登录 cookies 和 SMTP 密钥。Control 默认只监听 `127.0.0.1`，不要直接暴露到公网；远程访问请使用 SSH tunnel 或私有 HTTPS 入口。

## 本地开发

需要 Node.js 20+ 和 pnpm：

```bash
corepack enable
pnpm install
pnpm test
pnpm start
```

本地启动同样使用 `config/config.yaml` 和 `.env`。生产环境建议使用 Docker Compose，以确保浏览器依赖和持久化卷一致。

## 项目结构

```text
src/index.js          调度器和 CLI 入口
src/rngdle.js         登录、roll、结果解析
src/mail.js           SMTP 发送和邮件模板
src/control-server.js Control API 和静态页面
src/control-page.js   Control UI
config/               配置模板
docs/                 README 截图
```
