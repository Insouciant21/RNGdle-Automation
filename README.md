# RNGdle Automation

Astro 控制台与 Cloudflare Workers 每日自动化服务。默认每天按配置时区执行 RNGdle roll，可选生成并提交诗歌，再通过 SMTP 发送结果邮件。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Insouciant21/RNGdle-Automation)

![RNGdle Control](docs/control-page.png)

## 功能

- Astro SSR 控制台：Overview、Logs、Authentication、Settings、登录与首次密码设置
- 同源 `/api/*` 与邮件预览接口，实际邮件与预览使用同一模板
- SQLite Durable Object 持久化 Cookie、45 天每日状态、运行时配置、Control 密码哈希、Session、登录限流与最近日志
- Durable Object Alarm 调度 `roll → poem → email`，每个阶段独立持久化和重试
- 写操作与 Alarm 串行执行，对象重启后从已完成阶段恢复
- 登录失效时暂停任务并提示重新认证，提交 magic link 后恢复
- 可选回赞：轮询新的 `heart_received` 通知，为对方最近 7 天内的 roll 回点一次心；首启建立基线，默认关闭
- 保留可选 DeepSeek / OpenAI 兼容 LLM 作诗，生成后先做词块与质量校验再提交

## 本地开发

需要 Node.js 22.12+ 和 pnpm 11：

```bash
pnpm install
pnpm test
pnpm test:e2e
pnpm build
```

浏览器测试使用独立 workerd 与临时 SQLite 存储，不访问真实 SMTP、LLM 或 RNGdle 账号。若未安装 Chromium，先运行 `pnpm exec playwright install chromium`。

如需本地连接真实服务，先准备 `.env` 与 Worker secrets。`.env`、`.dev.vars`、`data/`、`backups/` 均已被忽略。

## 运行行为

- 默认调度：上海时间 `08:02`，可在 Settings 修改时区和时间
- RNGdle 失败默认 30 分钟重试，诗歌 5 分钟，邮件 1 分钟
- 已完成日期直接跳过；已有 roll 或诗歌会复用，不重复生成或提交
- 回赞默认每 10 分钟检查一次，每天最多 10 次；同一用户的多个通知只回赞一次，已有自己的心或 roll 过旧时跳过
- SMTP 密码在 Settings 中留空表示保留，且不会通过 API 返回
- Control Session 使用 Secure、HttpOnly Cookie，写操作要求同源和 CSRF Token
- SMTP 接受邮件后、状态保存前中断仍可能导致重复投递，系统不承诺严格一次发送

## 管理与备份

管理工具通过 `/__migration/*` 和独立 Bearer Token 访问。Token 保存在被忽略的 `data/cloudflare-migration.json`，可用 `MIGRATION_CREDENTIALS` 指定其他路径，`MIGRATION_ORIGIN` 临时覆盖目标地址。

```bash
pnpm cloudflare status
pnpm cloudflare pause
pnpm cloudflare resume
pnpm cloudflare backup backups/workers.json
```

备份包含配置、Cookie、每日状态、设置和密码哈希。恢复时先向空 Worker 导入，再验证并启用调度。

## 配置与安全

`CONFIG_JSON` 是包含基础配置及 SMTP、LLM 凭证的 Worker Secret；`MIGRATION_TOKEN` 是管理工具密钥，不是 Control 密码。二者都不会发送到前端。

生产 `CONTROL_PUBLIC_URL` 固定为 Wrangler 配置中的 HTTPS 地址，旧迁移备份中的 URL 不会覆盖它。生产构建不读取本地 `.env` 作为开发变量。旧 Docker 运维说明见 [legacy-docker.md](docs/legacy-docker.md)。

技术依据：[Astro Cloudflare 适配器](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)、[Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)、[Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)。
