---
name: chrome-shared-domyslnie
description: "MANDATORY before using any Chrome MCP. Usage rules for the shared Chrome MCP (one browser, window-per-session), including how to download files through it. Some sites block Chrome launched with automation flags (CAPTCHA, anti-bot) — this plugin's browser avoids that. DO NOT use any other Chrome automation without reading this skill first."
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

## Downloading files

**Download through the browser, the way a person would: click the site's own
download button or link. The file Chrome saves IS the result.** This browser
exists so that sites see a real user with real logins and cookies. Do not take
the file's URL from the network log or the page and fetch it outside the
browser (`curl`, `wget`, a script): where the site checks the session, cookies
or the browser itself, that breaks or gets blocked.

**But never click a download without arming it first.** Left to itself,
Chrome decides where the file goes, and in this setup it can open the
system "Save as" dialog on the user's screen. You cannot see or operate that
dialog: the download hangs until the user deals with it. The dialog cannot
be ruled out from the profile settings in advance, so arm every time.

### Arm, click, collect

`chrome-shared-download` (in this plugin's `bin/`, on `PATH`) makes Chrome
save the downloads of one window straight into a directory you choose — no
dialog, nothing left in the user's downloads folder (CDP
`Browser.setDownloadBehavior`, for that window's browser context only).

1. Find the tab number: the `[N]` at the start of your page's title in
   `list_pages`.
2. Start the command **in the background** (Bash `run_in_background: true`)
   and wait until its output shows `READY`:

   ```bash
   chrome-shared-download --tab N --dir /abs/target/dir --count K --timeout 300
   ```

   `--count` = how many downloads you are about to click (default 1),
   `--timeout` = seconds without any download activity before it gives up
   (default 300). Arm once for a whole batch.
3. Click the site's download button(s) with the browser tools as usual.
4. The command prints `BEGIN <name> <url>` when a download starts and
   `DONE <absolute path> <bytes>` when the file is complete, and exits after
   `K` files. Use the paths from the `DONE` lines.

Rules:

- **The override lives only while the command runs.** After it exits, the
  window is back to Chrome's own handling — and a click then may open the
  dialog again. Re-arm before every further download.
- No `BEGIN` after a click → the click did not start a download (wrong
  button, the site is still preparing the file, a site popup). Look at the
  page; do not fetch the file another way.
- `TIMEOUT` → nothing arrived in time; check the page and re-arm.
- Chrome may still show its download bubble for a moment — that's expected.
  A permission prompt "download multiple files" is Chrome's own bar, not a
  system dialog; if downloads stop after the first one, ask the user to allow
  it.
- A file of the same name in the target directory is overwritten. Use a fresh
  directory per task.
- `READY context=default` plus a `WARNING`: your tab is in the shared main
  window (no `isolatedContext`), so while the command runs, the user's own
  downloads in that window go to your directory too. Keep that window short;
  prefer an `isolatedContext` for downloads.
- In the network log the file request shows as `net::ERR_ABORTED`. That
  means "handed over to the download manager", NOT "failed". Do not download
  again.
- Do not check Chrome's `History` database to tell whether a download
  happened: Chrome keeps it in memory and the file on disk lags hours behind.

If a download was clicked without arming and the user reports a dialog, tell
them which file it is for and let them decide (save or cancel). Do not click
again.

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
