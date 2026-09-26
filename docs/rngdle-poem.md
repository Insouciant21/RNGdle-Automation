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

- `src/rngdle-http.js`：原生 `fetch`、Cookie 文件、响应大小限制、Server Action 请求与返回解析。
- `src/rngdle-assets.js`：获取当前首页脚本清单，发现最新 Action ID；用 Acorn 解析 AST，只读取字面量徽章词表、变形表和词类顺序，不执行网站代码。
- 本地按已核对的 `getWordsForBadges` 算法，用 roll 数字与 badge ID 确定性选择最多 3 个候选，直接生成 `MOUNTAIN_0` 等官方 ID。
- `src/poem-http.js`：HTTP 获取当天数据、构建词库、调用 LLM、直接 POST 词块数组、重新 GET `/api/home` 确认保存。
- `src/rngdle.js`：登录 magic-link 重定向、认证验证和每日 roll 同样走 HTTP。

脚本元数据按内容哈希资源 URL 缓存，最多 64 项；初次读取时最多同时下载 4 个脚本。词库内容随当前网站资源更新，无需维护整份词典。已核对的选词函数保存了源码指纹：若函数变化（包括压缩器改名），作诗会明确报错，等待适配，不冒险提交错词。首页脚本结构或 Server Action 协议改变也需要适配。

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


工作流为 `roll → poem_pending → email_pending → success`。草稿在提交前写入 `state.json`；重试先读取网站已有诗歌，再复用相同 roll、游戏日期、词库和审读版本的草稿。旧版未审读草稿会重新生成；通过审读的草稿在提交失败后可复用。邮件失败只重试邮件，不重新生成或提交。已有人工诗歌直接复用。

诗歌也显示在 Control 概览和结果邮件中。控制台显示作诗次数与下次重试时间；LLM 密钥不通过管理 API 返回。

## DeepSeek 配置

使用 [OpenAI 官方 JavaScript SDK](https://developers.openai.com/api/docs/libraries)，调用 DeepSeek 的 OpenAI 兼容 Chat Completions。

根据 [DeepSeek JSON Output 文档](https://api-docs.deepseek.com/guides/json_mode/)，默认模型使用 `deepseek-flash`，base URL 使用 `https://api.deepseek.com`，请求开启 `response_format: {"type":"json_object"}`。根据 [Thinking Mode 文档](https://api-docs.deepseek.com/guides/thinking_mode/)，本任务默认传入 `thinking: {"type":"disabled"}`。

```dotenv
POEM_ENABLED=true
POEM_RETRY_MINUTES=5
llm_endpoint=https://api.deepseek.com
llm_api_key=填写自己的密钥
llm_model=deepseek-flash
LLM_TIMEOUT_MS=60000
LLM_MAX_TOKENS=2048
LLM_MAX_ATTEMPTS=3
LLM_THINKING=disabled
```

支持对应的 `LLM_ENDPOINT`、`LLM_API_KEY`、`LLM_MODEL` 大写别名；非空小写变量优先。endpoint 是 API base URL，不是完整 `/chat/completions` 地址。默认关闭自动作诗以兼容未配置 LLM 的已有部署；开启时必须提供密钥。LLM 配置从环境加载，修改后需重启，暂不在 Settings 页面编辑。

## 操作与验证

本地命令会读取 `.env`：

```bash
pnpm poem:inspect  # 读取当天词库及实际 prompt；不调用 LLM、不提交
pnpm poem          # 为已有的今日 roll 生成并提交；不生成新 roll、不发结果邮件
```

与其他使用同一数据目录的工作流互斥。手动命令同样获取工作流锁。线上使用时先停止常驻容器，再通过 tools 服务执行，完成后恢复：

```bash
docker compose stop rngdle
docker compose --profile tools run --rm --service-ports once node src/index.js inspect-poem
docker compose --profile tools run --rm --service-ports once node src/index.js poem
docker compose start rngdle
```

`inspect-poem` 即使在当天已有诗歌时仍能通过 HTTP 返回词库、prompt 和已保存诗歌。`poem` 可对已经发过邮件的成功日期补诗，保留原邮件状态。自动调度不会为了补诗重新运行已经标记成功的日期。

登录存储：直接使用已有 HTTP 部署版本的 `cookies.json`（`{version:1,cookies:{name:value}}`）。响应中的 Cookie 更新原子写入该文件，文件权限为 `0600`。不读取旧浏览器 profile；只有旧 profile 的部署需要通过 Authentication 重新登录。`HTTP_TIMEOUT_MS` 取代旧浏览器超时配置，旧环境变量 `BROWSER_TIMEOUT_MS` 和运行时字段 `browserTimeoutMs` 仍能迁移读取。

2026-09-19 在此前浏览器实现中完成了真实 DeepSeek 调用和网站提交，回读确认：

> the different mountain, phantom soar!

共 7 个词块，包括逗号和感叹号。该验证只提交了今日诗歌，没有发送结果邮件，也没有更改远端服务代码或容器。

随后纯 HTTP 版本使用实际登录态完成了词库读取、Action ID 发现、已有诗歌回读及跳过验证；重建的 45 个词块、变形、徽章来源、顺序和标点分类与先前浏览器采集结果完全一致。由于当天诗歌已存在，没有覆盖或再次提交。

纯 HTTP 的提交路径通过本地 HTTP 服务测试，验证真实请求头、Cookie、嵌套数组请求体、RSC 返回解析、错误拒绝和响应丢失恢复。其他测试覆盖配置迁移、prompt、词块规则、OpenAI SDK 请求格式、输出修复、错误脱敏、跨日防护和各阶段重试。

2026-09-20 追加线上验证：SSH 认证恢复后，纯 HTTP 读取到当天 roll `2229`、39 个词块和当前 `submitPoem` Action ID，当天诗歌为空。DeepSeek `/models` 返回 200 并列出 `deepseek-flash`，但两次实际生成请求均返回 HTTP 503，因此未提交诗歌；远端常驻服务未更改。

同日再次重试成功：DeepSeek 生成诗歌后，通过纯 HTTP 提交到 roll `2229`，并独立回读确认网站保存的内容一致：

> nothing joins the unbroken lone stones or choruses but!

本次验证未使用浏览器、未发送结果邮件，远端常驻服务代码及容器未更改。

2026-09-26 修复语义质量：当天 roll `957435` 的原诗为 `rising over power half wonder wish a world, brush`。使用真实 DeepSeek 审读时，句意、语法和连贯意象三项均被拒绝；反馈后生成的 `a clear sky over the world` 通过审读和词块校验。另一次独立生成的 `a wish rising over the world, so clear` 同样通过。验证只调用 LLM，未覆盖当天已保存诗歌。
