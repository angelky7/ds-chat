# ds-chat

English | [简体中文](README.zh-CN.md)

A static chat frontend based on the official DeepSeek [chat-demo](https://github.com/deepseek-ai/chat-demo), adding multiple model providers, system prompt presets and appearance customization. No application backend is required: the browser connects directly to the configured API service.

- Live demo: <https://angelky7.github.io/ds-chat/>
- For offline use, build locally — the output is plain static files. Add the provider's API key under Settings → Providers before your first chat.

### Changes from upstream

- Providers: DeepSeek, Kimi, GLM, MiMo, Qwen and OpenRouter, each with its own key, endpoint and model (see [Providers](#providers)).
- Prompts: multiple presets, variable placeholders, opening messages and one-click restore (see [Prompts](#prompts)).
- Appearance: avatars, bubble colors and backgrounds (see [Appearance](#appearance)).

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

The bundle has no backend dependency, so GitHub Pages, Cloudflare Pages, and similar hosts work as-is. The bundled [.github/workflows/pages.yml](.github/workflows/pages.yml) checks types, lints, builds, and publishes `dist` on every push to `main`; select GitHub Actions under Settings → Pages → Build and deployment. Asset paths come from `publicPath: 'auto'`, so a project site served from `/<repo-name>/` resolves correctly. API keys and conversations stay in each visitor's own browser.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Multiple providers (DeepSeek, Kimi, GLM, MiMo, Qwen, OpenRouter), each with its own API Key.
- Multiple providers (DeepSeek, Kimi, GLM, MiMo, Qwen, OpenRouter), each with its own API Key.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Providers

Settings → Providers selects the model provider; each provider keeps its own API Key and the switch applies to the next message.

| Provider | Endpoint | Preset model |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/anthropic/v1/messages` | `deepseek-flash` |
| Kimi | `https://api.moonshot.cn/anthropic/v1/messages` | `kimi-k2.5` |
| GLM | `https://open.bigmodel.cn/api/anthropic/v1/messages` | `glm-4.6` |
| MiMo | `https://api.xiaomimimo.com/anthropic/v1/messages` | `mimo-v2.5-pro` |
| Qwen | `https://maas.qianwenaiapi.com/apps/anthropic/v1/messages` | `qwen3-max` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `openrouter/auto` |

- Everything except OpenRouter uses the Anthropic-compatible `/v1/messages`, the same code path as DeepSeek. OpenRouter only offers an OpenAI-compatible API, converted by a small adapter.
- Endpoint, model, and protocol can all be overridden: leaving the endpoint empty uses the preset, and the protocol can be switched to OpenAI-compatible for self-hosted gateways such as one-api or new-api.
- Keys, endpoints, and models are stored per provider in localStorage; a single legacy key is migrated to DeepSeek on first launch.
- Capabilities degrade per provider. Web search, document parsing, speech, server-side titles, and continuation are DeepSeek-only and are hidden elsewhere. Images are inlined as base64 for third-party providers; documents require DeepSeek.
- While the built-in default prompt is unchanged, third-party providers receive no DeepSeek identity prompt; custom presets are still sent.

## Prompts

Settings → Prompts manages the system prompt sent with every request:

- A built-in "DeepSeek default" preset holds the official default prompt, `该助手为DeepSeek，由深度求索公司创造。`, and "Restore default" brings it back after edits.
- Multiple presets: create, duplicate, delete; switch from the select in settings or from the pill in the conversation header. Changes apply from your next message.
- Variables `{{cur_date}}`, `{{cur_time}}`, `{{cur_weekday}}`, `{{model_name}}`, `{{locale}}`, `{{location}}` are resolved with the local date, language, and location before each request; click a variable chip to insert it at the cursor.
- An empty prompt falls back to the DeepSeek default. Presets are stored in localStorage only.

## Appearance

Settings → Appearance customizes the chat surface:

- Toggle avatars on or off; upload custom AI and user avatars, which are compressed and kept in localStorage.
- AI and user bubble colors: setting an AI bubble wraps replies in a bubble whose text color follows the bubble luminance; "Default" keeps the original design (light blue user bubble, no AI bubble).
- Background: none, solid color, gradient, or image; image backgrounds have an overlay strength setting, and the header and input area turn translucent.
- Light and dark themes store separate palettes, applied when each theme is active; the footer action resets everything.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
