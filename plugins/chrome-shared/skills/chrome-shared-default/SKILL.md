---
name: chrome-shared-domyslnie
description: "MANDATORY before using any Chrome MCP. Usage rules for the shared Chrome MCP (one browser, window-per-session). Some sites block Chrome launched with automation flags (CAPTCHA, anti-bot) — this plugin's browser avoids that. DO NOT use any other Chrome automation without reading this skill first."
---

# Chrome MCP — shared browser

**RULE: Before using ANY Chrome MCP tool, follow this skill.** Use ONLY the tools of this plugin's MCP server (prefix `mcp__plugin_chrome-shared_browser__*`, tool names like `list_pages`, `new_page`, `navigate_page`). Do not launch Chrome any other way.

## Availability check

Run `ToolSearch` with query `"select:mcp__plugin_chrome-shared_browser__list_pages"`.

**Tool loaded** → proceed with the usage rules below.

**Tool missing** → the chrome-shared plugin is not installed or not enabled. Tell the user to run:

> `/plugin marketplace add claudeholic/claudeholic-plugins`
> then `/plugin install chrome-shared@claudeholic-plugins` and restart Claude Code.

**STOP — do not fall back to any other Chrome automation.**

## Usage rules (shared browser)

All Claude sessions share ONE Chrome instance, started lazily by the plugin. To keep sessions from interfering with each other:

1. **Default: open pages with `isolatedContext`.** On the first `new_page` of the session, pass `isolatedContext` set to a short stable name for this session (e.g. the project or task name, like `"mostownia-testy"`). Reuse the SAME name for every subsequent `new_page` in this session. Effect: the session gets its own separate Chrome window, and its pages group as tabs inside that window.
2. **Exception — logged-in sites.** An isolated context has a fresh cookie jar (like incognito): no saved logins. When the task needs the shared profile's saved logins (e.g. LinkedIn, claude.ai), open that page WITHOUT `isolatedContext` — it becomes a tab in the shared main window. Go back to the isolated context for everything else.
3. **Never kill or restart Chrome** because it is "already running" or "busy" — it is shared by other sessions on purpose. If tools misbehave, report the problem instead of killing the browser.
4. Only interact with pages you opened yourself (your `pageId`s), unless the user explicitly asks about another page.
5. **First `tools/call` may be slow.** The shared engine starts lazily and shuts down after idle periods. If a call takes longer than usual, the engine is waking up — wait, don't retry or report an error.

## Tabs numbered for the user

The browser numbers its own tabs. A bundled extension prefixes every ordinary
tab title with `[N] `, e.g. `[7] Oferta pracy — justjoin.it`. The user sees
these numbers in the tab strip, so they are the shared language for pointing at
a tab.

**`[N]` is NOT an MCP `pageId`.** They are two unrelated numbering systems:

| | assigned by | scope | visible to user |
|---|---|---|---|
| `[N]` in the title | the browser extension | one per tab, whole browser | yes |
| `pageId` | the MCP server | per Claude session | no |

When the user says "tab [7]", "karta [7]" or similar:

1. Call `list_pages`.
2. Find the page whose **title starts with `[7] `**.
3. Use THAT page's `pageId` for the operation.

Never assume `[7]` means `pageId` 7 — they almost never match. If no page
carries that prefix, say so instead of guessing at a similar-looking tab.

Numbers are stable: they survive navigation and reload, and are not reused
after a tab is closed. So a number the user mentions keeps pointing at the same
tab for as long as it is open.

Every tab is numbered from one shared counter — the user's own tabs, and the
pages you open, including those in an `isolatedContext`. So you can also point
the user at your own work: "I opened it as tab [12]".
