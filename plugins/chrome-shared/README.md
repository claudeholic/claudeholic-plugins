# chrome-shared

Shared Chrome automation for Claude Code — one browser, many sessions. Linux only.

## Features

- **Multi-session** — many Claude sessions on one Chrome, shared logged-in profile, a window per session via isolated browser contexts.
- **Lazy launch** — Chrome starts on the first browser-tool call, not at session start. Sessions that never touch the browser never start it.
- **Numbered tabs** — a bundled extension prefixes every tab title (http, https, file) with `[N]`, giving the user and Claude a shared language for pointing at tabs. Numbers are stable across navigation and reload, and never reused after a tab is closed.
- **MCP multiplexer** — one shared `chrome-devtools-mcp` engine for all sessions, lightweight stubs per session (~46 MB instead of ~140 MB), routing through a Unix socket and a mux daemon.
- **Idle shutdown** — the shared engine shuts down after a period with no `tools/call` (default 2 hours, configurable via `CS_ENGINE_IDLE_MS`). The next call starts it again transparently; tabs in Chrome survive engine restarts.
- **Low memory footprint** — no resident `npx` process, no Google telemetry watchdog, engine installed once into `~/.cache/chrome-shared` and started directly with `node`. A background job keeps the engine up to date.
- **Regular-browser behavior** — Chrome launches without automation markers (`navigator.webdriver = false`, no `--enable-automation`), avoiding CAPTCHA triggers on sites like LinkedIn or claude.ai. This does **not** solve or bypass CAPTCHAs — it merely avoids provoking them.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CS_PROXY_PORT` | `9227` | Port for the lazy proxy |
| `CS_CHROME_PORT` | `9226` | Chrome CDP port |
| `CS_ENGINE_IDLE_MS` | `7200000` | Engine idle shutdown threshold (ms); `0` = never |
| `CS_TAB_NUMBERS` | `1` | Set to `0` to disable tab numbering |
| `CS_UPDATE_INTERVAL` | `21600` | Engine update check interval (seconds) |

## MCP server

Declared in `plugin.json` as `browser` — tools are available under the
`mcp__plugin_chrome-shared_browser__*` prefix. The underlying engine is
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

## Skills

| Skill | Origin |
|---|---|
| `chrome-shared-default` | own — mandatory usage rules for the shared browser |
| `chrome-devtools` | chrome-devtools-mcp (as-is) |
| `a11y-debugging` | chrome-devtools-mcp (as-is) |
| `chrome-devtools-cli` | chrome-devtools-mcp (as-is) |
| `debug-optimize-lcp` | chrome-devtools-mcp (as-is) |
| `memory-leak-debugging` | chrome-devtools-mcp (as-is) |
| `troubleshooting` | chrome-devtools-mcp (adapted for the shared-browser architecture) |

Skills marked "chrome-devtools-mcp" are copied from
[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
(Apache License 2.0 — see `LICENSE`). This plugin is an independent personal project that
works with Claude Code; it is not affiliated with Google or Anthropic.

## Requirements

- **Linux** with `google-chrome-stable` and `node` (≥22)
- macOS and Windows are not supported (the wrapper uses Linux-specific tools:
  `setsid`, GNU `readlink`/`mv -Tf`/`find -newermt`, bash `/dev/tcp` probing)

## Install

```
/plugin marketplace add claudeholic/claudeholic-plugins
/plugin install chrome-shared@claudeholic-plugins
```
