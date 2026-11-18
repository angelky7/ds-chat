# ds-chat

English | [简体中文](README.zh-CN.md)

A static chat frontend based on the official DeepSeek [chat-demo](https://github.com/deepseek-ai/chat-demo), adding multiple model providers, system prompt presets and appearance customization. No application backend is required: the browser connects directly to the configured API service.

- Live demo: <https://angelky7.github.io/ds-chat/>
- For offline use, build locally — the output is plain static files. Add the provider's API key under Settings → Providers before your first chat.

### Changes from upstream

- Providers: DeepSeek, Kimi, MiMo, Qwen, SiliconFlow and OpenRouter, each with its own key, endpoint and model (see [Providers](#providers)).
- Processing mode: **Fast** (default, text-only parsing, attachments sent once) and **Expert** (layout parsing, attachments resent every turn). A mode is a preset for the parsing depth, attachment resend, auto-compaction and its threshold, and the round limit; editing any of them switches the label to Custom.
- Processing mode: **Fast** (default, text-only parsing, attachments sent once) and **Expert** (layout parsing, attachments resent every turn). A mode is a preset for the parsing depth, attachment resend, auto-compaction and its threshold, and the round limit; editing any of them switches the label to Custom.
- Context compaction: condense older rounds into a structured checkpoint (manual, or automatically at a configurable 30–80% of the window); the original messages stay on this device. The policy and prompt layout are adapted from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT).
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
- Multiple providers (DeepSeek, Kimi, MiMo, Qwen, SiliconFlow, OpenRouter), each with its own API Key.
- Multiple providers (DeepSeek, Kimi, MiMo, Qwen, SiliconFlow, OpenRouter), each with its own API Key.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Android app

`android/` holds a dependency-free WebView shell. It opens the live site on launch, so the app shares the browser's origin: cross-origin behaviour, localStorage and IndexedDB match the web version. It does not bundle a copy of the site, so site updates need no new APK.

- **Download**: <https://github.com/angelky7/ds-chat/releases/download/android-latest/ds-chat.apk> (~35 KB, rebuilt by CI whenever `android/` changes)
- Supports the back button, external links (such as "Get API Key") opening in the browser, file picking for avatars and attachments, and an offline page with retry
- Minimum: Android 7.0 (API 24)

`.github/workflows/android.yml` installs JDK 17 and Android SDK 34, runs `gradle assembleDebug`, then verifies package name, launcher activity, app label, icons and the INTERNET permission with `aapt` before publishing to a Release. The APK is debug-signed so it installs without extra setup.

To change the package name, app label or launch URL, edit `android/app/build.gradle` and `HOME_URL` in `MainActivity.java`, then push — CI rebuilds automatically.

## Providers

Settings → Providers saves an API Key per provider and lets you **connect several providers at once**. Each key can carry **several models**; switch between them from the model menu at the bottom-right of the input box, effective from the next message.

| Provider | Preset endpoint | Protocol | Browser direct |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/anthropic` | Anthropic-compatible | ✅ |
| Kimi | `https://api.moonshot.cn/v1` | OpenAI-compatible | ✅ (`/anthropic` fails preflight) |
| MiMo | `https://api.xiaomimimo.com/anthropic` | Anthropic-compatible | ✅ |
| Qwen | `https://maas.qianwenaiapi.com/compatible-mode/v1` | OpenAI-compatible | ✅ (`/apps/anthropic` returns 401 on preflight) |
| SiliconFlow | `https://api.siliconflow.cn/v1` | OpenAI-compatible | ✅ |
| SiliconFlow | `https://api.siliconflow.cn/v1` | OpenAI-compatible | ✅ |
| SiliconFlow | `https://api.siliconflow.cn/v1` | OpenAI-compatible | ✅ |
| SiliconFlow | `https://api.siliconflow.cn/v1` | OpenAI-compatible | ✅ |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible | ✅ |

- Saving: the key row has its own **Save**, and endpoint / protocol / model list are committed with **Save settings** at the bottom. A saved key is masked; click the pencil icon to replace it.
- Models: type a model ID and press Enter (or Add) to append it as a removable chip. Leave the list empty to use the preset models.
- Endpoint and protocol are overridable: an empty endpoint uses the preset, and the protocol can be switched for self-hosted gateways such as one-api or new-api.
- Configuration is stored per provider in localStorage; a single legacy key is migrated to DeepSeek on first launch.
- Capabilities degrade per provider. Web search, document parsing, speech, server-side titles, and continuation are DeepSeek-only and are hidden elsewhere. Images are inlined as base64 for third-party providers; documents require DeepSeek.
- While the built-in default prompt is unchanged, third-party providers receive no DeepSeek identity prompt; custom presets are still sent.
- SiliconFlow aggregates DeepSeek, Qwen, GLM and Kimi models behind one key. Model IDs look like `deepseek-ai/DeepSeek-V3.2` or `Qwen/Qwen3-8B`; copy the full ID from its model catalog. Get a key at <https://cloud.siliconflow.cn/account/ak>.
- **Custom providers**: in Settings → Providers, click **+ Custom** and fill in a name, endpoint, protocol (OpenAI- or Anthropic-compatible) and a model list to connect any compatible gateway (one-api, new-api, LiteLLM, your own reverse proxy). The endpoint is the part before `/chat/completions` or `/v1/messages`; separate models with commas or newlines, the first becomes the default. Custom entries support chat and images only, up to 20 of them, and can be deleted together with their key.
- **Custom providers**: in Settings → Providers, click **+ Custom** and fill in a name, endpoint, protocol (OpenAI- or Anthropic-compatible) and a model list to connect any compatible gateway (one-api, new-api, LiteLLM, your own reverse proxy). The endpoint is the part before `/chat/completions` or `/v1/messages`; separate models with commas or newlines, the first becomes the default. Custom entries support chat and images only, up to 20 of them, and can be deleted together with their key.
- Image attachments are re-encoded to JPEG before sending (long edge capped at 2048 px, quality 0.9). The APIs only accept JPEG/PNG/GIF/WebP, so BMP, TIFF, AVIF or SVG passed through unchanged are rejected as "unsupported image". Formats the browser cannot decode are reported instead of sent.
- SiliconFlow aggregates DeepSeek, Qwen, GLM and Kimi models behind one key. Model IDs look like `deepseek-ai/DeepSeek-V3.2` or `Qwen/Qwen3-8B`; copy the full ID from its model catalog. Get a key at <https://cloud.siliconflow.cn/account/ak>.
- **Custom providers**: in Settings → Providers, click **+ Custom** and fill in a name, endpoint, protocol (OpenAI- or Anthropic-compatible) and a model list to connect any compatible gateway (one-api, new-api, LiteLLM, your own reverse proxy). The endpoint is the part before `/chat/completions` or `/v1/messages`; separate models with commas or newlines, the first becomes the default. Custom entries support chat and images only, up to 20 of them, and can be deleted together with their key.
- **Custom providers**: in Settings → Providers, click **+ Custom** and fill in a name, endpoint, protocol (OpenAI- or Anthropic-compatible) and a model list to connect any compatible gateway (one-api, new-api, LiteLLM, your own reverse proxy). The endpoint is the part before `/chat/completions` or `/v1/messages`; separate models with commas or newlines, the first becomes the default. Custom entries support chat and images only, up to 20 of them, and can be deleted together with their key.
- Image attachments are re-encoded to JPEG before sending (long edge capped at 2048 px, quality 0.9). The APIs only accept JPEG/PNG/GIF/WebP, so BMP, TIFF, AVIF or SVG passed through unchanged are rejected as "unsupported image". Formats the browser cannot decode are reported instead of sent.
- **CORS**: on a purely static deployment the browser calls each API directly, so an endpoint that does not allow cross-origin requests is blocked and the UI reports it. Keep Kimi and Qwen on their default OpenAI-compatible endpoints; providers whose endpoints block cross-origin requests can still be used through a custom provider entry pointing at your own reverse proxy.

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
