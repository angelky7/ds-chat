# ds-chat

[English](README.md) | 简体中文

基于 DeepSeek 官方 [chat-demo](https://github.com/deepseek-ai/chat-demo) 的静态聊天前端，增加了多家模型服务商、系统提示词预设与外观自定义。无需应用后端，浏览器直接请求配置的 API 服务。

- 在线体验：<https://angelky7.github.io/ds-chat/>
- 需要本地离线使用时可自行构建，产物为纯静态文件；首次使用时在「设置 → 模型服务」中填写对应服务商的 API Key。

### 相对上游的改动

- 模型服务：DeepSeek、Kimi、GLM、MiMo、通义千问、OpenRouter，各自独立保存 Key、地址与模型（见[模型服务](#模型服务)）。
- 提示词：多套预设、变量占位符、开场消息与一键恢复默认（见[提示词](#提示词)）。
- 外观：头像、气泡颜色、背景（见[自定义外观](#自定义外观)）。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

产物没有任何后端依赖，可直接托管在 GitHub Pages、Cloudflare Pages、Vercel 等静态服务上。仓库自带的 [.github/workflows/pages.yml](.github/workflows/pages.yml) 会在推送到 `main` 后执行类型检查、lint、构建并把 `dist` 发布到 Pages：在仓库 Settings → Pages → Build and deployment 中选择 GitHub Actions 即可。资源路径由 `publicPath: 'auto'` 按脚本地址推导，因此部署在 `/<仓库名>/` 这样的子路径下也能正常加载。API Key 与对话数据都保存在访问者自己的浏览器中，站点本身不保存任何密钥。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 多家模型服务商：DeepSeek、Kimi、GLM、MiMo、通义千问、OpenRouter，各自独立保存 API Key。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 模型服务

「设置 → 模型服务」可以为多家服务商分别保存 API Key（**可同时挂载多家**），每家的 Key 下可以挂**多个模型**，在输入框右下角的模型菜单里随时切换，切换后从下一条消息生效。

| 服务商 | 预设接口 | 协议 | 浏览器直连 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/anthropic` | Anthropic 兼容 | ✅ |
| Kimi | `https://api.moonshot.cn/v1` | OpenAI 兼容 | ✅（`/anthropic` 预检不放行） |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 | ❌ 两种协议都不放行，需自建反代 |
| MiMo | `https://api.xiaomimimo.com/anthropic` | Anthropic 兼容 | ✅ |
| 通义千问 | `https://maas.qianwenaiapi.com/compatible-mode/v1` | OpenAI 兼容 | ✅（`/apps/anthropic` 预检 401） |
| 火山引擎（方舟） | `https://ark.cn-beijing.volces.com/api/v3` | OpenAI 兼容 | ✅ |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 | ✅ |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 | ✅ |
| 火山引擎（方舟） | `https://ark.cn-beijing.volces.com/api/v3` | OpenAI 兼容 | ✅ |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 | ✅ |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 | ✅ |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI 兼容 | ✅ |

- 保存方式：Key 处有「保存」，地址／协议／模型列表改完点底部「保存配置」，两者分别生效；Key 保存后只显示掩码，点铅笔图标可重新输入。
- 模型列表：输入模型 ID 后回车或点「添加」，逐个以标签展示，可单独移除；留空则使用预设列表。一个 Key 下挂几个模型就都能在模型菜单里选到。
- 接口地址、协议可覆盖：地址留空用预设，协议可选 Anthropic 兼容或 OpenAI 兼容，便于接入 one-api、new-api 之类的自建网关。
- 配置按服务商分别保存在本机 localStorage；旧的单 Key 记录会在首次启动时自动迁移到 DeepSeek。
- 能力随服务商降级：联网搜索、文档解析、语音朗读与听写、服务端生成标题、续写仅 DeepSeek 提供；其他服务商的界面上不显示这些入口。图片附件在第三方服务商下按 base64 内联发送，文档附件请切换到 DeepSeek。
- 未改动内置默认提示词时，其他服务商不会收到声明 DeepSeek 身份的系统提示词；自定义预设仍会照常发送。
- 火山引擎用方舟的 OpenAI 兼容入口（`/api/v3/chat/completions`），默认模型 `doubao-seed-2-1-pro-260915`；方舟另有一个 `/api/v3/responses`（Responses API，请求体与事件格式不同），本应用不使用它。方舟未开放 `/api/v3/models`，所以 Key 保存时无法在线校验，错误会等到第一次对话才提示。Key 申请：<https://ark.volcengine.com/region:cn-beijing/apikey>。
- 火山引擎用方舟的 OpenAI 兼容入口（`/api/v3/chat/completions`），默认模型 `doubao-seed-2-1-pro-260915`；方舟另有一个 `/api/v3/responses`（Responses API，请求体与事件格式不同），本应用不使用它。方舟未开放 `/api/v3/models`，所以 Key 保存时无法在线校验，错误会等到第一次对话才提示。Key 申请：<https://ark.volcengine.com/region:cn-beijing/apikey>。
- 硅基流动聚合了 DeepSeek、Qwen、GLM、Kimi 等模型，一个 Key 即可切换；模型 ID 形如 `deepseek-ai/DeepSeek-V3.2`、`Qwen/Qwen3-8B`，以模型广场的完整 ID 为准。Key 申请：<https://cloud.siliconflow.cn/account/ak>。
- **自定义服务商**：设置 → 模型服务 → 右上角「＋ 自定义」，填名称、接口地址、协议（OpenAI 兼容 / Anthropic 兼容）与模型列表即可接入任意兼容网关（one-api、new-api、LiteLLM、自建反代都行）。地址填到 `/chat/completions` 或 `/v1/messages` 之前的部分；多个模型用逗号或换行分隔，第一个作为默认。自定义项只提供对话与图片能力，最多 20 个，可随时删除（连同 Key 一起清掉）。
- **自定义服务商**：设置 → 模型服务 → 右上角「＋ 自定义」，填名称、接口地址、协议（OpenAI 兼容 / Anthropic 兼容）与模型列表即可接入任意兼容网关（one-api、new-api、LiteLLM、自建反代都行）。地址填到 `/chat/completions` 或 `/v1/messages` 之前的部分；多个模型用逗号或换行分隔，第一个作为默认。自定义项只提供对话与图片能力，最多 20 个，可随时删除（连同 Key 一起清掉）。
- 图片附件统一转成 JPEG 后再发送（长边不超过 2048 px，质量 0.9）：接口只接受 JPEG/PNG/GIF/WebP，BMP、TIFF、AVIF、SVG 等原样透传会被判为「unsupported image」。浏览器无法解码的格式会直接提示另存为 JPG 或 PNG。
- 硅基流动聚合了 DeepSeek、Qwen、GLM、Kimi 等模型，一个 Key 即可切换；模型 ID 形如 `deepseek-ai/DeepSeek-V3.2`、`Qwen/Qwen3-8B`，以模型广场的完整 ID 为准。Key 申请：<https://cloud.siliconflow.cn/account/ak>。
- **自定义服务商**：设置 → 模型服务 → 右上角「＋ 自定义」，填名称、接口地址、协议（OpenAI 兼容 / Anthropic 兼容）与模型列表即可接入任意兼容网关（one-api、new-api、LiteLLM、自建反代都行）。地址填到 `/chat/completions` 或 `/v1/messages` 之前的部分；多个模型用逗号或换行分隔，第一个作为默认。自定义项只提供对话与图片能力，最多 20 个，可随时删除（连同 Key 一起清掉）。
- **自定义服务商**：设置 → 模型服务 → 右上角「＋ 自定义」，填名称、接口地址、协议（OpenAI 兼容 / Anthropic 兼容）与模型列表即可接入任意兼容网关（one-api、new-api、LiteLLM、自建反代都行）。地址填到 `/chat/completions` 或 `/v1/messages` 之前的部分；多个模型用逗号或换行分隔，第一个作为默认。自定义项只提供对话与图片能力，最多 20 个，可随时删除（连同 Key 一起清掉）。
- 图片附件统一转成 JPEG 后再发送（长边不超过 2048 px，质量 0.9）：接口只接受 JPEG/PNG/GIF/WebP，BMP、TIFF、AVIF、SVG 等原样透传会被判为「unsupported image」。浏览器无法解码的格式会直接提示另存为 JPG 或 PNG。
- **跨域限制**：纯静态部署时请求由浏览器直连各家接口，对方未开放 CORS 就会被浏览器拦截（界面上会提示「无法连接…」）。GLM 需要把接口地址改成自建反代；Kimi 与千问请保持默认的 OpenAI 兼容通道。

## 提示词

「设置 → 提示词」管理随请求发送的系统提示词：

- 内置「DeepSeek 默认」预设，内容即官方默认提示词「该助手为DeepSeek，由深度求索公司创造。」；改动后点「恢复默认」可一键还原。
- 支持多套预设：新建、复制、删除；在设置里用下拉框切换，或在会话顶栏右侧的胶囊按钮直接切换，均从下一条消息开始生效。
- 支持变量 `{{cur_date}}`、`{{cur_time}}`、`{{cur_weekday}}`、`{{model_name}}`、`{{locale}}`、`{{location}}`，每次请求前按本机时间、语言与位置解析；点变量标签即可插入到光标处。
- 内容留空时回落到 DeepSeek 默认提示词；预设只保存在本机 localStorage。
- 预设聊天消息（开场 user / assistant 对话）：每套预设可配置最多 20 条开场消息。新建对话时按顺序写入为真实消息，既显示在对话里，也作为示例对话进入请求上下文；同样支持变量占位符。欢迎页会预览前三条，发送后即为正式消息。
- 预设聊天消息（开场 user / assistant 对话）：每套预设可配置最多 20 条开场消息。新建对话时按顺序写入为真实消息，既显示在对话里，也作为示例对话进入请求上下文；同样支持变量占位符。欢迎页会预览前三条，发送后即为正式消息。

## 自定义外观

在「设置 → 外观」中可以调整聊天界面的视觉样式：

- 显示头像开关；AI 头像与用户头像支持上传图片，自动压缩后保存在本机 localStorage。
- AI 气泡颜色与用户气泡颜色：选择颜色后 AI 回答会显示在气泡中，文字色按气泡亮度自动切换黑/白；「默认」沿用官方样式（用户浅蓝气泡、AI 无气泡）。
- 背景：无、纯色、渐变或图片；图片背景可调遮罩强度，标题栏与输入区自动改为半透明。
- 深色与浅色主题分别保存一套配色，切换主题时各自生效；底部「恢复默认外观」可整体重置。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
