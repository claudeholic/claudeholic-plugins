---
name: browsers
description: "Przeglądarki i poczta CREK: pokazuje listę przeglądarek w kolejności użycia (domyślnie chrome-shared, potem przeglądarki zapasowe na wypadek CAPTCHY) i dostęp do poczty dla kodów weryfikacyjnych, pozwala je dodać, usunąć, przestawić i sprawdza, czy naprawdę działają. Używaj, gdy użytkownik pisze np. „skonfiguruj przeglądarki”, „sprawdź przeglądarki”, „czy przeglądarki działają”, „dodaj przeglądarkę zapasową”, „dodaj Brave / Chromium jako fallback”, „zmień kolejność przeglądarek”, „usuń przeglądarkę”, „dostęp do maila”, „czy możesz czytać kody z maila”, „ustaw pocztę”, i gdy inny skill CREK zgłasza, że żadna przeglądarka nie przeszła blokady. EN: show, change and verify the browsers CREK uses in order (chrome-shared first, fallbacks for CAPTCHAs) and the mailbox access for verification codes. Use on 'set up browsers', 'check the browsers', 'add a fallback browser', 'reorder browsers', 'mail access', 'can you read codes from my mail'."
---

**Plugin root: `${CLAUDE_PLUGIN_ROOT}`** — commands in `references/*.md` (and in the other CREK skills' references) write `${CLAUDE_PLUGIN_ROOT}`, which is filled in only in this file, not there and not in the Bash tool: always run them with the path above in its place.

# Browsers and mail — what CREK may use when a site pushes back

Two settings in `crek.config.json` decide what CREK does when a site sends a code by e-mail or
puts up a CAPTCHA (the procedure itself: *Codes by e-mail, CAPTCHAs and the browser list* in
`../apply/references/ats-playbook.md`):

- `browser.browsers` — the browsers in the order of use. The first does all the work (by default
  chrome-shared); the next ones are tried only after a CAPTCHA or an anti-bot check in the one
  before. Not set: chrome-shared alone, plus the pre-1.12 `browser.cdp_fallback_port` as the second.
- `mail` — whether there is access to the candidate's mailbox, through which tools, and whether
  CREK may read a verification code or link there on its own (`read_verification_codes`).

Every field is documented in `${CLAUDE_PLUGIN_ROOT}/assets/crek.schema.json`. Speak to the user in
`presentation.language` (Polish when not set).

## 0. The config

Check that `crek.config.json` exists. If it does not, tell the user, offer the bootstrap interview
(`../apply/references/bootstrap.md`, question 9 covers these settings) and stop. Otherwise run
`node "${CLAUDE_PLUGIN_ROOT}/assets/crek-config-check.mjs" crek.config.json` and mention any error
or warning about `browser` or `mail` before going on.

## 1. Show the current setup

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-browsers.mjs" --config crek.config.json
```

It prints the browsers in the order of use — name, type, how CREK connects (chrome-shared's MCP
tools and port, a CDP port, another MCP server's tool prefix), the profile, the start command and
whether CREK may run it — and the mail line (access, tools, permission). Show it as a short
numbered list; say where it came from (`browser.browsers`, or the default when it is not set).

## 2. Verify that it works

Run it whenever the user asks to check, after every change, and when another skill reports that
no browser got past a block:

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-browsers.mjs" --config crek.config.json --check --tab-test
```

For each browser: `/json/version` on its debugging port, then **one `about:blank` tab opened in the
background and closed at once** over the browser's own endpoint — proof that CREK can drive it,
not just that a port answers. Nothing else in the browser is touched. Statuses:

- `OK` — works (the browser's name and version, `background tab: ok`).
- `IDLE` — chrome-shared, not started yet: its browser starts on the first call of its tools.
  Call `list_pages` (chrome-shared tools), then run the check again for it (`--name chrome-shared`).
- `DOWN` — nothing answers, or the tab test failed. With a `start_command`: offer to start it
  (step 4); without one, the user starts it. If the user says the browser is already open, it was
  started without the debugging port: ask them to close it and start it with the command —
  never close it yourself.
- `TOOLS` — an MCP browser (`type: "mcp"`): look for its tools (`ToolSearch` with the
  `tool_prefix`); when they are there, call its tab-listing tool once (read only). Missing tools →
  the server is not in this session.
- `DISABLED` — `enabled: false`, kept on record.
- `WARNING … also answers on <address>` — the debugging port is reachable from the network: tell
  the user to start that browser with `--remote-debugging-address=127.0.0.1` (or without the
  address flag) — anyone on the network could drive it.

**Mail**, when `mail.access` is `mcp`: check that the tools are in the session (`ToolSearch` with
`mail.tool_prefix`), then make **one** read-only call that proves access without reading any
message — with the claude.ai Gmail connector `search_threads` with `query: "newer_than:1d"`,
`pageSize: 1`, `view: "THREAD_VIEW_IDS_ONLY"`; with another mail server its search tool, the
smallest query it takes. Report only "works" or the error — never a subject, a sender or a body.
No tools → the connector is not enabled for this session (claude.ai, Settings, *Connectors*) or the
server is not configured.

Report a table: `# | Browser | Type | Connection | Status | Background tab | Notes`, then the mail
line (`access — tools — works / error — read codes on its own: yes / no`), then what needs the
user (start a browser, enable a connector, close an exposed port).

## 3. Change it

The user may add, remove, reorder, enable or disable browsers, change the mail access or the
permission. For a **new browser** ask what the bootstrap interview asks (question 9): name, type
(`cdp` for a Chromium-based browser with a debugging port, `mcp` for another browser MCP server),
port or tool prefix, a word on the profile, whether it is the user's own everyday profile
(`user_profile`), the start command and whether CREK may run it (`may_start`). Before a `cdp`
entry, say plainly what a debugging port means (*Working in another browser* in the ats-playbook):
while it is open, every program on the machine can drive that browser and read every site it is
signed in to. Recommend a separate profile (`--user-data-dir=<a directory of its own>`); an
everyday profile is the user's informed choice. Google Chrome 136 and later ignores
`--remote-debugging-port` on its default profile directory; other Chromium-based browsers may
not — the check in step 2 tells. Typical start commands, with a port and a directory of the
user's choice:

```bash
chromium --remote-debugging-port=9230 --user-data-dir="$HOME/.config/chromium-jobs"
google-chrome --remote-debugging-port=9231 --user-data-dir="$HOME/.config/chrome-jobs"
brave-browser --remote-debugging-port=9232 --restore-last-session
```

Then:

1. Show the new `browser.browsers` / `mail` blocks next to the old ones and ask for a yes.
2. Write only those blocks into `crek.config.json` — every other field stays as it is, the file
   stays `chmod 600`. A `browser.cdp_fallback_port` left from before 1.12 becomes an entry of the
   list (`{"name": "fallback", "type": "cdp", "cdp_port": <port>}` unless the user names it) and
   the old field is removed — with the list set, it is ignored.
3. Run the config check, then step 2 for what changed.

The order is the order of use: chrome-shared normally stays first. A user who wants another
browser first may have it — then that one does all the work, and chrome-shared becomes a fallback.

## 4. Start a browser

Only a browser on the list with a `start_command`, only when nothing answers on its port, and
only when the user agrees now or its `may_start` is `true`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-browsers.mjs" --config crek.config.json --start <name>
```

It runs the command detached and waits up to 20 s for the port. It never stops, kills or restarts
a browser — and neither do you: no `pkill`, no closing windows, no restarting to add a flag. If it
does not answer, the browser was most likely already running without the debugging port; tell
the user.

## Do not

- Do not open, select, navigate, reload or close any tab in any browser beyond the one test tab
  the script opens and closes itself.
- Do not read messages in the mailbox to "test" it — one search that returns ids only is enough.
- Do not put a browser on the list, open a debugging port or start a browser without the user's
  word; do not change chrome-shared's own settings.
- Do not write passwords, codes or mail content into the conversation or the config notes.
