# RNGdle Compose Poem：接口、规则与实现

检查时间：2026-09-19。依据是 `https://www.rngdle.com/` 的实际登录页面、浏览器网络请求和当时发布的前端代码。以下不是网站承诺稳定的公开 API。

## 接口与数据来源

| 功能 | 当前实现 |
| --- | --- |
| 登录状态、当天 roll、徽章、已保存诗歌 | `GET /api/home`，读取 `viewer.hasRolledToday`、`viewer.lastRoll` |
| Word Bank | 无独立 HTTP endpoint。前端 `getWordsForBadges(badges, rollNumber)` 本地生成 |
| Word from badge / Filter by badge | 无独立 HTTP endpoint。根据词块的 `badgeId` 高亮匹配项，其余项变淡；不会移除其他词块 |
| 允许的词形变化 | 前端 `WORD_VARIANTS` 映射；编辑器中的 “Choose another form of …” 菜单 |
| Shuffle | 本地改变词块显示顺序，不会获得新词或重置用量 |
| Submit poem | `POST /`，Next.js Server Action `submitPoem` |

浏览器捕获的提交格式：

```http
POST https://www.rngdle.com/
Content-Type: text/plain;charset=UTF-8
Next-Action: 409a75baa9c4fca99f605d7ddc6021fe422e0cea7f
```

```json
[[{"id":"MOUNTAIN_0","variant":"mountains"},{"id":"HELIUM_0"}]]
```

上面的 Action ID 只是检查当日的值，网站部署后可能变化。HTTP 请求携带已保存的 Cookie，`Accept: text/x-component` 和空的 `Next-Router-State-Tree`。嵌套数组的外层是 Server Action 参数列表，内层是有序词块选择。客户端处理的返回对象包含 `success`、`text` 或 `error`；不能仅凭 HTTP 200 判断保存成功。

协议检查时拦截了测试 POST，未向网站保存测试文字。随后使用真实 LLM 输出完成了一次提交，并通过新的 `/api/home` 请求确认已保存。

前端代码来源（文件名可能随部署变化）：

- [Compose Poem 编辑器与 submitPoem 引用](https://www.rngdle.com/_next/static/chunks/817f220079f79fda.js)
- [getWordsForBadges 和 WORD_VARIANTS](https://www.rngdle.com/_next/static/chunks/7ae1d5a4d2527da0.js)

## 规则

1. 必须登录并已有当天 roll；是否显示功能还受网站功能开关控制。
2. 选取 1–10 个词块，标点也计入 10 个名额；没有要求必须用满。
3. 同一词块 ID 只能使用一次。原形与变形共用这个名额。
4. 相同文字、不同 ID 的词块可以分别使用，例如词库中两枚 `the`。
5. 只能使用词块原形或菜单中列出的变形；不能自行添加单词、词尾、标点或换行。
6. 前端按徽章和 roll 数字确定性选择词块。每个已定义词池的徽章最多贡献 3 个词块，候选不超过 3 个时全部保留。不会只取 `isScoring=true` 的徽章。
7. 网站词块 ID 形如 `BADGE_ID_原候选索引`。词库按词类和词文字排序。
8. 最终文本转为小写；普通词前加空格，标点紧贴前一词。没有独立的标题或多行输入。
9. 已保存诗歌后，页面显示诗歌并隐藏 Compose Poem 按钮。本实现始终保留已有诗歌，不尝试覆盖；没有破坏性测试服务端能否强制覆盖。
10. 每日 roll 按 UTC 日期切换。生成前和提交前核对 roll 数字及游戏日期，防止跨日提交到另一条记录。

这次登录态检查：roll `238410`，15 个徽章，45 个词块。例如 `rise` 可变为 `rises / rose / risen / rising`，`mountain` 可变为 `mountains`。完整词库应实时读取，不能把这一天的内容用于以后日期。

## 本项目如何实现

当前实现完全使用 HTTP，不安装或启动浏览器：

- `src/rngdle-http.js`：原生 `fetch`、Durable Object Cookie 存储、响应大小限制、Server Action 请求与返回解析。
- `src/rngdle-assets.js`：获取当前首页脚本清单，发现最新 Action ID；用 Acorn 解析 AST，只读取字面量徽章词表、变形表和词类顺序，不执行网站代码。
- 本地按已核对的 `getWordsForBadges` 算法，用 roll 数字与 badge ID 确定性选择最多 3 个候选，直接生成 `MOUNTAIN_0` 等官方 ID。
- `src/poem-http.js`：HTTP 获取当天数据、构建词库、调用 LLM、直接 POST 词块数组、重新 GET `/api/home` 确认保存。
- `src/rngdle.js`：登录 magic-link 重定向、认证验证和每日 roll 同样走 HTTP。

脚本元数据按内容哈希资源 URL 缓存，最多 96 项；每日任务初次读取时最多同时下载 4 个脚本。词库内容随当前网站资源更新，无需维护整份词典。已核对的选词函数保存了源码指纹：若函数变化（包括压缩器改名），作诗会明确报错，等待适配，不冒险提交错词。首页脚本结构或 Server Action 协议改变也需要适配。

词库携带官方词块 ID；模型输出可读词语序列，程序按词库匹配为官方 ID 后保存草稿和提交。匹配支持不同 ID 的同词词块及重叠变形，不会重复占用同一 ID。

`src/poem.js` 生成两条消息：

- system：英文微诗的目标、最多 10 块、ID 不重复、只用白名单变形、标点与小写规则，以及 JSON 输出格式。
- user：当天 roll 数字、完整 `wordBank`、规则和 `wordsFromBadges`（徽章名称、含义及其词块 ID）。账号邮箱、Cookie 和 SMTP 凭据不会进入 prompt。

创作优先级为：句意清楚、英语自然，其次是鲜明意象，最后才是数字关联。仍从数字特征和徽章寻找灵感，但词库受限时可以省略数字关联，不为此拼接无意义词语。不要求凑满十块，短而完整的名词短语也可以。不能添加词库之外的数字、数词或解释。

生成阶段输出格式（示例词语仅作格式说明）：

```json
{"words":["a","clear","sky"]}
```

程序把词语与精确变形匹配到互不重复的官方词块，校验数量与变形白名单，再渲染文本。随后发起独立审读请求：审读上下文只提供诗歌，不提供数字、徽章或作者解释，避免替不通顺的句子牵强附会。审读必须返回 `understandable`、`naturalEnglish`、`coherentImage` 三项布尔值、简短释义 `meaning` 和问题列表 `problems`；三项均为真、有释义且问题列表为空才可提交。审读输出缺失、截断或格式不合法同样不予通过。

词块或审读不通过时，把被拒文本与具体问题反馈给生成模型，最多生成 `LLM_MAX_ATTEMPTS` 轮（默认三轮，每轮最多一次生成、一次审读，共六次请求）。次数耗尽后保留失败状态，交给工作流稍后重试，不提交未通过审读的文本。网络错误不在 SDK 内重复重试。审读仍由 LLM 完成，能减少无意义输出，不能保证文学质量。


工作流为 `roll → poem_pending → email_pending → success`。草稿在提交前写入 Durable Object；重试先读取网站已有诗歌，再复用相同 roll、游戏日期、词库和审读版本的草稿。旧版未审读草稿会重新生成；通过审读的草稿在提交失败后可复用。邮件失败只重试邮件，不重新生成或提交。已有人工诗歌直接复用。

诗歌也显示在 Control 概览和结果邮件中。控制台显示作诗次数与下次重试时间；LLM 密钥不通过管理 API 返回。

## DeepSeek 配置

使用 [OpenAI 官方 JavaScript SDK](https://developers.openai.com/api/docs/libraries)，调用 DeepSeek 的 OpenAI 兼容 Chat Completions。

根据 [DeepSeek JSON Output 文档](https://api-docs.deepseek.com/guides/json_mode/)，默认模型使用 `deepseek-flash`，base URL 使用 `https://api.deepseek.com`，请求开启 `response_format: {"type":"json_object"}`。根据 [Thinking Mode 文档](https://api-docs.deepseek.com/guides/thinking_mode/)，本任务默认传入 `thinking: {"type":"disabled"}`。

```dotenv
POEM_ENABLED=true
POEM_RETRY_MINUTES=5
LLM_ENDPOINT=https://api.deepseek.com
LLM_API_KEY=填写自己的密钥
LLM_MODEL=deepseek-flash
LLM_TIMEOUT_MS=60000
LLM_MAX_TOKENS=2048
LLM_MAX_ATTEMPTS=3
LLM_THINKING=disabled
```

配置使用上述大写 Workers 变量。endpoint 是 API base URL，不是完整 `/chat/completions` 地址。自动作诗默认关闭；开启时必须将 `LLM_API_KEY` 配为 Worker Secret，其他参数使用普通 vars，修改后重新部署。

## 操作与验证

通过 Workers 管理接口检查登录态、词库和 LLM 生成能力：

```bash
pnpm cloudflare verify rngdle
pnpm cloudflare verify poem  # 调用 LLM 检查生成能力，不向网站提交
```

自动提交由 Durable Object Alarm 执行，已完成日期不会重新运行。Cookie、每日状态和诗歌草稿均保存在 Durable Object 中，可通过 `pnpm cloudflare backup` 备份。

HTTP 测试覆盖请求头、Cookie 持久化、词块数组、RSC 返回解析、错误拒绝及响应丢失恢复；其他测试覆盖 prompt、词块规则、模型输出修复、错误脱敏、跨日防护和各阶段重试。
