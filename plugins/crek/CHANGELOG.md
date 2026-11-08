# Changelog

## 1.12.1 — 2026-11-08

- **A batch opens together, in order, and nothing is left behind.** A batch used to be split: the
  postings without a login in a window of CREK's own (an isolated context, tabs without `[N]`,
  numbered by position "from the anchor"), the LinkedIn and Indeed ones in the user's main window
  — and rows added later went to the end, out of the table's order, while the old window and its
  anchor stayed open. Now the whole batch opens in **one window of its own in the shared,
  logged-in profile** (no `isolatedContext`), so every tab has its `[N]`; the tabs run in the
  order of the table's rows and their `[N]` grow in the same order. *The batch window* in
  `reporting.md` is rewritten: no anchor and no position numbers for batches any more; a row that
  drops out (closed, a repeat) is closed and its replacement — the next posting in sort order —
  added at the end; any other change of order opens the batch again from scratch, never appended
  out of order. Switching batches closes the previous batch and every other tab or window the
  session left open (research pages, forms, CV previews, a scan's anchor); when the review is
  over, the batch's tabs are closed and its window goes with them.
- **New script `assets/crek-batch-tabs.mjs`** does it deterministically: `open --rows` (the rows
  in table order) opens the first row as a new window (`Target.createTarget` with `newWindow`)
  and every later row as a background tab of that window; after every tab it checks the window
  it landed in (`Browser.getWindowForTarget`) and opens a stray once more after bringing the batch
  window forward, otherwise closes everything it opened and exits 3. Tabs open one after another,
  each loaded before the next, with a random 2–4 s pause after a board the user is signed in to
  (LinkedIn, Indeed, `--paced-hosts`) — the pace for showing a batch only; scanning and reading
  those boards keep their 3–6 s; pages are not read, clicked or scripted. `--replace`
  closes the old tabs once the new ones are open, `--append-to N` adds a replacement at the end of
  the batch's window, `check --tabs` (table order) reports a batch spread over windows, out of
  order or with another tab in its window (exit 4), and `close --tabs` closes tabs by `[N]`,
  never the browser's last one.
- `job-scan`: at the end of a scan the anchor is closed too (last), with the scan's window and
  every tab the login-board agent left; the batch never opens in the scan's window. *Presenting
  pages to the user* and the `report` skill (steps 1, 2, 4–6, *After the user rules*, *Do not*)
  say the same; the closed and repeat checks run with `--tabs` on every row again.
- The ats-playbook (*LinkedIn*) and both READMEs (*Risks*) name the batch opener as the one script
  that opens LinkedIn pages — as ordinary tabs, one at a time with a 2–4 s pause, never read or clicked
  by it. The READMEs describe the new batch window (steps 3 and 6).
- **Scan summary** (new section in `reporting.md`): a finished scan opens its report with a table
  per board — *Board*, *Viewed*, *Passed the filter*, *Admitted after analysis*, *Rated 9+* (PL
  *Portal*, *Obejrzane*, *Przeszły filtr*, *Dopuszczone po analizie*, *Ocena 9+*), with a total
  line; new i18n keys `report.section.scan_summary`, `report.col.board`, `report.col.viewed`,
  `report.col.collected`, `report.col.admitted`, `report.col.top`, `report.value.total` (also in
  the web app's copy).
- **New script `assets/crek-scan-summary.mjs`** prints that table from the collectors' counts
  (`--counts`: `{"crek_scan_counts": [{"board", "viewed", "collected"}]}` per agent, boards by key
  or name, a board reported twice summed) and the admitted rows (`--ids`, their `source` and
  `match_score` read from the pipeline). It warns about a `source` that is not a board's name, a
  board without counts and impossible counts; `--json` too.
- `job-scan`: new section *Counts for the scan summary* — every collector (scan agents, the
  login-board agent, the main session for its own boards) counts per board what it viewed and what
  passed the title check and ends its report with the `crek_scan_counts` JSON line; the ready
  prompt texts say so. Step 1: a posting's `source` is the board's `name` exactly, nothing added
  (an aggregator's original source goes into `description`). Step 8 prints the summary first.

## 1.12.0 — 2026-11-08

- **New skill `crek:browsers`**: shows the browsers CREK uses, in the order of use, and the
  mailbox access; adds, removes, reorders, enables and disables them (asking before every write
  to the config); and **verifies that they work** — `/json/version` on each debugging port, one
  `about:blank` tab opened in the background and closed again, a warning when a port answers on
  a network address, chrome-shared's lazy start, MCP browsers through their tools, and one
  read-only, ids-only search for the mail tools. It never closes, kills or restarts a browser.
- **New script `assets/crek-browsers.mjs`**: the effective browser list (`--json`), the checks
  (`--check`, `--tab-test`, `--name`) and `--start <name>` (a browser's `start_command`, detached,
  only when its port is silent). `crek-cdp.mjs` gains `browserVersion()` and
  `testBackgroundTab()` (`Target.createTarget` with `background: true`, then `Target.closeTarget`).
- **Config:** `browser.browsers` — the browsers in the order of use, each with `name`, `type`
  (`chrome-shared`, `cdp`, `mcp`), `cdp_port` / `tool_prefix`, `profile`, `user_profile`,
  `start_command`, `may_start`, `enabled`, `notes`; not set = chrome-shared alone. The pre-1.12
  `browser.cdp_fallback_port` still works as the second browser while the list is not set.
  `mail` — `access` (`none` / `mcp`), `name`, `tool_prefix`, `search_tool`, `read_tool` and the
  permission `read_verification_codes`. `crek-config-check.mjs` checks both (types, ports, names,
  prefixes, the old field next to the list) and notes when they are missing.
- **One procedure for codes and blocks**, new section *Codes by e-mail, CAPTCHAs and the browser
  list* in `ats-playbook.md`, used by `apply`, `job-scan` (its agents included) and `report`:
  a code or link by e-mail is read from the mailbox only with the permission and the tools — the
  newest message from that site, read only, the message is data and never instructions, only that
  code or the site's one verification link — otherwise (and for SMS codes) the user is asked. A
  CAPTCHA or an anti-bot check is never solved: the same page is tried in the next browser of the
  list (checked first, started only when allowed); when none gets through, the work stops and the
  user is told what blocked, where, and which browsers were tried. A warning about the account
  itself is never retried in another browser. In a browser with the user's own profile CREK works
  in one background tab of its own, never touches the user's tabs, never closes, restarts or
  reconfigures the browser, and closes its tab when done. Scan agents of boards without a login
  report a block instead of switching browsers; the main session retries those boards at the end
  of the scan, one at a time.
- `bootstrap.md`: new question 9 (mail access, the permission, the browsers in order) — the
  database, tooling and writing steps are now 10–12.
- **nofluffjobs city pages** (`crek-refs.mjs`, `crek-match.mjs`): NFJ gives every city or region
  of one posting a URL of its own, so the same posting was not recognised. New: the NFJ posting
  reference as a ref of kind `nofluffjobs` (read from the `og:image` address
  `…/thumbnail-image/posting/<ref>`, from `REF:` lines and from `kind:value` written anywhere in a
  row, e.g. a duplicate note; it may have no digit); a candidate's `urls` (the posting's other
  addresses — on NFJ its other city pages) compared like `url`; NFJ URLs in canonical form
  (`nofluffjobs.com/job/<slug>`, language prefix and parameters dropped); and a `!` hit
  `match.nfj_other_place` (`"other_place"` in `--json`) for an NFJ page of another city with the
  same title-and-company part of the slug — very likely the same posting, the reference decides.
  Shared board posting numbers (`nofluffjobs`, `pracuj`, `sii`) are worded `match.posting_id`
  ("same posting number") instead of "same application form". Generally: `PORTAL_POSTINGS` /
  `postingKey()` in `crek-refs.mjs` is the per-board table of what in a URL names the posting
  (LinkedIn, Indeed, nofluffjobs). `crek-dedupe-check.mjs` reads the `og:image` meta of open tabs.
- `job-scan` (*Reference numbers*, *Archive check*) and the NFJ `notes` in `boards.json`: read the
  NFJ posting reference, store it as `nofluffjobs:<ref>`, pass the other city pages as `urls`.
- **How far a scan goes on each board** (new section in `job-scan`): every researched board in
  `boards.json` has a `listing` — sort options, publication-time filter and its URL parameter,
  date sort, whether the date order is strict (`true` / `false` / `null` = not established),
  pagination, limit, where the facts come from (`verified`, "not verified" for second-hand ones) —
  and a `stop_rule`: `time_filter` (filter to the window, read the whole filtered list; past the
  board's limit split the query, then by relevance until it clearly drops), `date_order` (sort by
  date, stop at the first posting older than the window), `date_order_unverified` (the same while
  the order holds, one more page past the first older posting, `low_quality` on the first posting
  out of order), `low_quality` (read everything realistically readable, mark the board in the
  report as a low-quality search with the reason). Data from research on 2026-11-08 for justjoin.it,
  nofluffjobs, solid.jobs, theprotocol, bulldogjob, rocketjobs, pracuj.pl, LinkedIn, Indeed,
  Wellfound, WeWorkRemotely, RemoteOK, Remotive and Himalayas; boards without a `listing` are
  judged on the page in the same order. Scan agents and the report's *Boards scanned* say, per
  board, which rule was applied and why reading stopped (`report.value.stop_*`,
  `report.value.low_quality_search`). Schema: `$defs.listing`, allowed in `boards.extra` and
  `boards.override`; `crek-config-check.mjs` checks its `stop_rule`.
- READMEs: new section *Browsers, CAPTCHAs and codes by e-mail*, the new skill in *Commands*,
  *Risks* and *Your data* updated, a paragraph on how deep a scan goes.
- Tests: `tests/browsers.test.mjs` and `tests/boards.test.mjs` (new; the stop rule must follow
  from the recorded facts), NFJ cases in `refs.test.mjs` and `match.test.mjs`, the new fields in
  `config-check.test.mjs`.

## 1.11.6 — 2026-11-07

- New section *Boards you are signed in to: browse like one person* in `ats-playbook.md`: on
  LinkedIn, Indeed and any site where CREK works in the user's login, every skill (scan, apply,
  report, closed checks) works like one person at one browser — one agent on those sites at a
  time (the main session leaves them alone meanwhile), one tab and one action at a time (a page
  loaded and read before the next; no several tabs, clicks or tool calls at once, browser or
  `linkedin-mcp`), ordinary page views through the site's own search, filters and "next page",
  scrolling in steps with random pauses of a few seconds (about 3–6 s). It limits the pace, not
  the volume: as many result pages and postings as the task needs, never stopping after a page or
  two "to be safe"; only a block stops a board.
- `job-scan`: point 4 of *One browser window per scan* (the login-board agent) and its ready
  prompt text spell out the same rules; the login-board agent stays one agent, in parallel with
  the agents of the other boards. *LinkedIn* says "as many as the task needs" instead of "open
  only the postings you need"; *Presenting pages to the user* opens login-board postings one
  after another.
- Wording that read as a page limit is gone: "only the pages the task needs" (ats-playbook,
  *LinkedIn*), "only the pages you need" (login-board prompt), "low volume" (`bootstrap.md`),
  "Keep LinkedIn work small" / "Ogranicz pracę na LinkedIn do minimum" (READMEs, *Risks*).
- `report` (step 2), `reporting.md` (*The batch window*) and the `apply` skill (*LinkedIn*):
  postings and pages behind the user's login open one after another, with pauses. The LinkedIn and
  Indeed `notes` in `boards.json` and both READMEs (*Scan*, *Risks*) say the same.

## 1.11.5 — 2026-11-03

- `job-scan`, *One browser window per scan*, point 4: boards that need a login (LinkedIn, Indeed
  and the like) are no longer the main session's part after the agents — that made a scan 20–30
  minutes longer. They go to **one** login-board agent, started in parallel with the other scan
  agents and the only one that touches LinkedIn and Indeed in the scan. It works in the shared
  logged-in profile (no `isolatedContext`), opens its tabs with `background: true` in the user's
  regular window (two windows in all: the scan's and that one), one posting at a time with pauses,
  works only on its own `pageId`s and closes them, and may use the `linkedin-mcp` tools. A ready
  text for that agent's prompt is in the skill; the other agents' text now says another agent does
  the login boards.
- Sign-in: on any login page, in either browser, the agent signs in with the portal's stored
  password (`credentials.<portal>`, e.g. `credentials.linkedin`); no stored password, or one that
  does not get in, is a block. On a block — a CAPTCHA, a security check, a verification, a code by
  SMS or e-mail, a warning — it never solves or clicks through it: if the config has a second
  browser (`browser.cdp_fallback_port`) and it answers on the port, the agent tries the board
  again there over CDP; blocked there too, or no second browser, it stops that board and reports
  it, and the main session asks the user. The `linkedin-mcp` login window is the server's own
  Patchright browser, which no CREK tool can drive: the agent cannot sign in there, so it reports
  it and goes on in chrome-shared. `bootstrap.md` says the same instead of "the password is for
  chrome-shared only".
- Batches open in **the batch window** (new section in `reporting.md`): right after a scan the
  scan's window with its anchor — the scan no longer closes the anchor at its end — otherwise a
  window with its own anchor (`crek-report-YYYYMMDD-HHMM`), also for the `report` skill without a
  scan. Postings that need the user's login to show (LinkedIn, Indeed and the like) still open in
  the shared context. The anchor is closed when the review is over: the last batch ruled on, the
  rest set aside, or the user asks. Batch-window tabs have no `[N]` prefix, so their Tab is the
  tab's position in that window (shared-context tabs written `[395]`), a line above the table says
  so, and the user's answer is read against the printed table. Their closed and repeat checks use
  `crek-closed-check.mjs --urls` and `crek-dedupe-check.mjs --ids`, since `--tabs` finds tabs by
  `[N]` only.
- The *LinkedIn* notes in the job-scan skill and the ats-playbook, *Presenting pages to the user*,
  the `report` skill, the `browser.cdp_fallback_port` description in the schema and the *Risks* in
  both READMEs say the same.

## 1.11.4 — 2026-11-03

- `job-scan`: the scan's anchor tab is no longer an empty `about:blank`, which the user could take
  for a stray tab and close, taking the scan's window with it. It is now
  `assets/crek-anchor.html`, opened as `file://${CLAUDE_PLUGIN_ROOT}/assets/crek-anchor.html`:
  a large "CREK Anchor" (the C in the CREK web app's accent colour), "Do not close this page
  while CREK agents are working for you." and a smaller Polish line, tab title
  "CREK Anchor — do not close". Dark or light after the system setting, with the web app's
  colours; no scripts, no external resources. The optional `document.title` step is gone, and the
  ready text for agents now says never to close the anchor page (CREK Anchor). If the file does
  not load, the anchor falls back to `about:blank`.

## 1.11.3 — 2026-11-03

- `job-scan`: new section *One browser window per scan*. A scan split across agents opened one
  Chrome window per agent, because each agent picked its own `isolatedContext` name and in
  chrome-shared every new name is a new window; a LinkedIn login window opened alongside them.
  Now the main session opens an anchor tab (`about:blank`) in one context named for this scan
  (`crek-scan-YYYYMMDD-HHMM` — context names are shared by all Claude sessions on the computer),
  and every board page goes into that context with `new_page` `background: true`, so it joins the
  anchor's window without coming to the front. Each agent gets the name and the rules in its
  prompt (a ready text is in the skill): only that context, in the background, only its own
  `pageId`s, its tabs closed after each board, the anchor left alone, no agents of its own. The
  anchor holds the window until the end of the scan, when the main session closes it. The same
  applies to a scan without agents.
- Boards that need a login (LinkedIn, Indeed and the like) are the main session's part, in the
  default context or through `linkedin-mcp`, before or after the agents — never in parallel. A
  `linkedin-mcp` login window stops the LinkedIn part until the user signs in.
- A rule in the skill, not a hook; chrome-shared is unchanged.

## 1.11.2 — 2026-11-03

- Bootstrap interview (`skills/apply/references/bootstrap.md`): right after the `linkedin-mcp`
  step — whether the plugin was there, installed or skipped — it asks whether to store the
  LinkedIn login and password in the config, saying that the password reaches the model
  (Anthropic) like the rest of the config. Yes → `credentials.linkedin` with `user`, `password`
  and `login_method: "password"`, used to sign in to LinkedIn in the chrome-shared browser when its
  session is missing; no → nothing is stored and Claude asks the user to sign in when needed.
  Until now the skills used `credentials.linkedin` but the interview never asked for it, so a
  clean install never had it. A stored password does not change the rule: on a CAPTCHA, a
  security check or a warning, Claude stops and tells the user.
- The `linkedin-mcp` step no longer says "never ask for the LinkedIn password": signing in to
  that server's login window stays the user's, and the stored password is for the browser only.
- README (*Example session*, PL and EN) mentions the question.

## 1.11.1 — 2026-11-03

- Bootstrap interview (`skills/apply/references/bootstrap.md`): before the first question it
  checks whether the `linkedin-mcp` plugin is installed — LinkedIn MCP tools in the session first,
  then `claude plugin list --json` — and handles three cases: missing (suggests
  `/plugin install linkedin-mcp@claudeholic-plugins`, recommended but not required; without it
  LinkedIn goes through the browser), installed but disabled (`claude plugin enable`), installed
  but without tools in the session (`/reload-plugins`, uv check). Claude installs it only when
  the user asks, never signs in to LinkedIn for the user and does not call LinkedIn during the
  interview. A "skip" is not stored — the interview runs once. `linkedin-mcp` stays out of
  `dependencies`. Found in a test on a clean account: chrome-shared came in as a dependency,
  linkedin-mcp did not, and the interview did not mention it.
- `apply` Step 0 and README (*Example session*, PL and EN) mention the check.

## 1.11.0 — 2026-11-03

Fixes from the third pre-publication review.

**No LinkedIn API any more**
- `crek-closed-check.mjs`, `crek-dedupe-check.mjs` and `crek-cdp.mjs` no longer call LinkedIn's
  internal web API (`/voyager/api/...`, the session cookie, its CSRF header); `LI_DECORATION` and
  the `jobState` logic are gone. A LinkedIn tab is judged by its page text alone: the known closed
  phrase → `closed`, anything else → `unknown` (never `open`), and Claude reads the page.
  `judge()` takes the page only.
- `--urls` (closed-check) and `--open-earlier` (dedupe-check) never open LinkedIn pages
  themselves: such rows come back `unknown` / with a warning. dedupe-check reads refs from the
  posting's own panel of a LinkedIn tab when it finds one; LinkedIn's external Apply target is not
  read by the script (a warning says so).
- Skills (job-scan *LinkedIn*, report, apply, reporting.md, ats-playbook.md): with the
  `linkedin-mcp` plugin installed and configured, Claude uses its tools; without it, Claude opens
  LinkedIn in the browser and reads and clicks like a person — one page at a time, stopping at a
  CAPTCHA, a security check or a warning. README *Risks*: the Voyager paragraph is replaced by
  warnings about LinkedIn automation and about `linkedin-mcp`. `boards.json` notes updated.

**Web app** (`assets/crek-php`; redeploy needed, see below)
- Language and theme switches (PL / EN, dark / light) in the header, applied without a reload and
  remembered in the browser (`localStorage`). Defaults from `config.php`: `$ui_lang`, `$ui_theme`
  (both optional; unset = Polish, dark). `config.php` is read before the language is chosen;
  nothing in `index.php` is edited any more.
- The status lists (filter, form, board columns) and their labels come from the dictionary's
  `ui.status.*` keys — the same list api.php accepts; no hard-coded list.
- `api.php` checks types like crek-db.mjs (below) and refuses an empty status.
- The pause after a missing or wrong token is 0.2 s instead of 1 s (`php -S` serves one request at
  a time).
- Level 2 (local UI): README, `config.php.example` and the bootstrap interview say to **copy**
  `assets/crek-php` to a directory of the user's and keep `config.php` there — the plugin's
  directory is replaced on update. PHP is a stated requirement (`php-cli php-sqlite3`).

**Pipeline and scripts**
- crek-db.mjs (every backend): whole numbers for `match_score`, `salary_*`, `my_rate_*`,
  `duplicate_of_id` (strings of digits are converted), real `YYYY-MM-DD` dates for
  `applied_date` / `response_date`; `jobs:update` never clears `status` (`""` / `null` → error),
  documented as the exception to "`""` sets NULL"; `jobs:append ID FIELD -- TEXT` for a text that
  starts with `-`.
- crek-dedupe-check: a failure (no such row, no tab) goes to the warning column / `warning`, never
  into the note meant for the pipeline.
- `--lang`, then env `CREK_LANG`, then `presentation.language`: the same order in crek-match,
  crek-dedupe-check and crek-closed-check, as job-scan says.
- Counts without broken Polish plurals: `duplikaty: 1, …` instead of `1 duplikatów` in the
  summaries of crek-dedupe-check and crek-closed-check, the crek-match header and the UI's contact
  counter.
- crek-config-check warns about a config readable by others always — it holds personal data —
  not only when it holds secrets.
- `html-to-pdf.mjs` never overwrites its input: a name without `.html` / `.htm` gets `.pdf`
  appended.

**Documentation**
- Fallback browser described the same way in README and ats-playbook: a second browser of the
  user's, on a separate profile, with an honest note that a fresh profile may still fail a
  score-based check.
- Cookie banners: "reject" / "only necessary" first, then close / X, "accept" only when there is
  nothing else.
- `scoring.md`: the wrong comparison of a blocker with an uncovered requirement is gone.
- Comment examples that looked like real pipeline rows replaced with plainly fictional ones.
- `.gitignore`: everything the CV template produces in place (HTML, PDF, pictures).

**Tests**: text-only LinkedIn verdicts, no LinkedIn API in any script, dedupe warnings and
language order, types and `--` in crek-db, the config-permission warning; with PHP: language and
theme from `config.php`, the status lists from the dictionary (a new `ui.status.*` key shows up
and is accepted), api.php types, the short pause.

**Deploying the web app:** upload `api.php`, `index.php`, `crek-auth.php` (keep `config.php`;
optionally add `$ui_lang` / `$ui_theme`). An older `api.php` keeps working with the plugin.

## 1.10.0 — 2026-11-03

Fixes from the second pre-publication review.

**The web app requires its API token** (`assets/crek-php`; redeploy needed, see below).
- `api.php` and `index.php` answer nothing without the token `$api_token` from `config.php`,
  sent on every request in the `X-Crek-Token` header and compared with `hash_equals`: no header
  or a wrong one → HTTP 401 after a one-second pause, no data and, for `index.php`, no application
  code. No token configured (or one shorter than 64 characters) → HTTP 503 for everything, with
  what to set. No login form, session or cookie; the token never goes into a URL or a page.
- The plugin sends it from the new optional config field `db.token`; a browser through a header
  extension (e.g. ModHeader, restricted to the app's URL). HTTP basic auth of the web server
  stays possible as an extra layer and never replaces the token. New shared file `crek-auth.php`.
- `config.php.example`: the token first (`openssl rand -hex 32`), SQLite (Option A) active by
  default, MySQL commented out. A failed database connection answers a generic error and goes to
  the server log; no DSN or user in the response, `display_errors` off.
- Configs without `db.token` keep working against an older `api.php` (which checks no token);
  crek-config-check warns about the missing field. The bootstrap interview generates the token
  and writes it into both configs.

**Pipeline writes**
- `jobs:append` is one statement on every backend (SQLite `||`, MySQL `CONCAT`, api.php's new
  route `POST jobs/{id}/append`): parallel appends no longer lose lines. On an `api.php` without
  the route (404 "Not found") crek-db falls back to the old read-and-write.
- `status` must be one of the `ui.status.*` keys of `assets/i18n.json` — checked by crek-db.mjs and
  by api.php (from `i18n.json` next to it, else from the copy in `index.php`); an unknown value is
  refused with the allowed list. No CHECK / ENUM in the schema.
- MySQL: `description`, `notes`, `communication`, `meetings` are `MEDIUMTEXT` (TEXT stops at
  64 KB). Existing databases need the `ALTER TABLE` given in `schema.sql`. Minimum versions in the
  README: MySQL 5.7.22 / MariaDB 10.5.
- `crek-db init` makes a SQLite file `chmod 600`; crek-config-check warns when it is readable by
  others. `jobs:list --fields` with an unknown column is an error; driver errors print one
  `error:` line (`CREK_DEBUG=1` for the stack). `--auth` on a command line is marked as visible in
  `ps` everywhere; env `CREK_TOKEN` / `CREK_AUTH` go with `--api`.

**Skills and references**
- Every SKILL.md starts with the plugin root (`${CLAUDE_PLUGIN_ROOT}` is substituted there only)
  and tells Claude to use it in the commands from `references/*.md`.
- Closed postings: the script's phrase list is a fast path, not the definition. Claude reads the
  page when the script does not report `closed` and never adds phrases to the script,
  `boards.json` or the config; likewise for reference-number patterns. `judge()` and the phrases
  moved to `assets/crek-closed-rules.mjs`.
- Blockers: the stale "do not move a blocked posting into the main table" paragraph in
  reporting.md is gone, and apply no longer declines a blocked posting on its own — `scoring.md`
  rules (shown, a minus, a lower score; the user decides).
- crek-dedupe-check writes match reasons into notes in English whatever the presentation language;
  its notes are dated `DD.MM.YYYY` like the rest of the plugin.
- job-scan no longer triggers on "the next batch"; "next" / "następne" belong to report.
- Warning (README *Risks*, ats-playbook) about the debugging port of the user's own browser:
  a separate profile, localhost only, closed after use. Behaviour unchanged.
- Examples that echoed a real profile or pipeline replaced with fictional ones.
- README: "IT job market in Poland", PHP / MySQL / MariaDB versions, which script output is
  translated and which stays English, crek-config-check described as hand-written checks.

**Other**
- `html-to-pdf.mjs` builds the file URL with `pathToFileURL` (`#`, `?`, `%` in paths).
- SPDX headers in `schema.sql`, `schema.sqlite.sql`, `tests/fixtures/fake-mysql.mjs`; a
  `.gitignore` in the plugin.
- Tests: the real api.php / index.php under `php -S` on SQLite (token: none / wrong / right, not
  configured, CRUD, append, unknown status, 415, foreign Origin / Host, a broken connection;
  skipped without PHP, `CREK_PHP` picks a binary), crek-dedupe-check `--ids` (verdicts, note
  language and date), `judge()` on sample pages, crek-config-check (backend, token, blockers,
  cv.master, file modes, git), atomic appends on SQLite and over HTTP, the append fallback.

**Deploying the web app:** upload `api.php`, `index.php`, `crek-auth.php`; add `$api_token` to
the server's `config.php`; put the same value in `db.token` and in the browser's header
extension. Until then an older `api.php` keeps working with the plugin as before.

## 1.9.2 — 2026-11-02

Fix: false hard duplicates from a shared ATS form address.

- `canonicalUrl()` (crek-refs) is inverted: instead of keeping a short list of id parameters and
  dropping the rest, it drops only known tracking / navigation parameters (`utm_*`, `mtm_*`,
  `pk_*`, `hsa_*`, `lever-*`, `fbclid`, `gclid`, `msclkid`, `ref`, `refId`, `source`, `src`,
  `sourceId`, `from`, `trk`, `trackingId`, `lipi`, `gh_src`, `lang`, … — `TRACKING_PARAMS`) and
  keeps every other one, sorted. eRecruiter postings (`WebID` / `oid`) and embedded Greenhouse
  forms (`token`) no longer collapse into one URL. LinkedIn job links (`/jobs/view/…-<id>`,
  `?currentJobId=`) reduce to `linkedin.com/jobs/view/<id>`, Indeed (`jk`, `vjk`) to
  `<host>/viewjob?jk=<id>`. Only comparison changes; stored URLs stay as they were.
- On a known ATS the posting id decides, not the form address (`sameUrlPosting()`): the same
  canonical URL with no shared posting id is not a hard duplicate (`match.same_url_no_id`).
- Safety net: the same URL under two different companies (agency / company named on both sides
  and different) is at most a suspicion — `!` with `match.same_url_other_company`, `url_suspect`
  in `--json` — never `!!`; crek-dedupe-check keeps such a posting in the batch with a note
  (`dedupe.note.url_suspect`) instead of recording `duplicate`.
- crek-dedupe-check passes its language to crek-match, so the reasons quoted in its notes follow
  `--lang` / `presentation.language` (they were always Polish).
- Tests: different / same eRecruiter WebID, Greenhouse embed tokens, tracking parameters,
  LinkedIn / Indeed forms, a shared form across companies.
- The copy of i18n.json in `crek-php/index.php` is refreshed; the web app does not use the new
  keys, so a hosted install needs no redeploy for this release.

## 1.9.1 — 2026-11-02

- Creating accounts on job portals is now the candidate's choice, not a fixed rule: new optional
  config field `conduct.account_creation` — `auto` (Claude creates the account itself) or `ask`
  (Claude asks first, naming the portal); not set means `ask`. Asked in the bootstrap interview;
  crek-config-check reports a missing field as a note, an unknown value as an error.
- Resetting the password of an existing account is not covered by that field: Claude always asks
  first (a reset can lock the candidate out of their own sessions).
- Tests for crek-config-check and the conduct fields of the schema.

## 1.9.0 — 2026-11-02

Preparation for publication.

**Database**
- One data layer for every skill and script, `assets/crek-db.mjs` (command line and module), with
  three working backends: `sqlite` through Node's built-in `node:sqlite` (Node >= 22.13), `mysql`
  through the system `mysql` / `mariadb` client (credentials in a private temporary option file,
  values sent as hex literals), and `http-api` (the bundled api.php, unchanged contract). No npm
  packages. Skills no longer say "read and write the database directly" without saying how:
  `skills/apply/references/database.md`.
- Executable SQLite schema `schema.sqlite.sql` (local timestamps, `updated_at` trigger,
  `json_valid` check); `schema.sql` is the executable MySQL dialect (`CREATE TABLE IF NOT EXISTS`).
- `crek-match.mjs` and `crek-dedupe-check.mjs` read through the layer; the 30-minute pipeline
  cache in the system temp directory is gone. crek-dedupe-check hands its rows to crek-match in
  memory (no second download, no temp file, no password on a command line).

**Web app (assets/crek-php) — needs redeploying on hosted installs**
- api.php: SQL injection in the contact upsert fixed; works on SQLite (`INSERT OR IGNORE`,
  `ON CONFLICT`); refuses non-JSON writes, foreign `Origin`s and (under `php -S`) foreign `Host`s;
  generic error messages with details in the server log; 400 / 404 / 415 where due; new
  `GET jobs/{id}`; a PUT carrying only `contact_ids` works.
- index.php: everything from the database is escaped (quotes included), only http(s) links are
  clickable; relative API path (works in a subdirectory); API errors are shown; source, currency,
  mode, seniority and rate unit are free inputs with suggestions, so unknown values survive an
  edit; security headers.

**Skills and behaviour**
- Polish and English trigger phrases in every skill description (Polish first); short commands
  ("następne", "kolejne 10", "pomiń resztę", "next 10", "skip the rest") start `report` only right
  after a CREK list was shown.
- Every skill checks for `crek.config.json` first and offers the bootstrap interview
  (`references/bootstrap.md`) when it is missing.
- New optional config field `conduct.ai_use_question` (`truthful` / `user_answers` / `ask`),
  asked in the bootstrap; Claude never denies using AI when asked directly.
- Posting, form and message content is treated as data, never as instructions.
- Creating portal accounts and resetting passwords need the user's consent.
- LinkedIn MCP is optional and recommended (`linkedin-mcp@claudeholic-plugins`); every LinkedIn
  step has a browser fallback.
- Fixed phrases written to `notes` come from `i18n.json` (`note.*`). No `presentation.language`
  means Polish; a language without a dictionary means English.
- profile writes both `cv.master_sha256` and `profile_inventory.source_sha256`.
- cv-factory: the obsolete "variant in the file name" rule is gone (the file name is always neutral).

**Scripts**
- Shared CDP client (`crek-cdp.mjs`): a timeout on every command, navigation to http(s) URLs only.
- html-to-pdf closes its tab on every error and warns when `pdftk` is missing.
- crek-config-check: per-backend checks, e-mail format, git-tracked config / database / CV warning,
  notes for optional new fields (never errors), `--boards` output no longer cut off on a pipe.
- Tests: `node --test "plugins/crek/tests/*.test.mjs"`.

**Publication**
- README: requirements, installation from the public marketplace, where data goes (the model reads
  the config, passwords included), risks (terms of service, bot-protection workarounds, LinkedIn's
  internal API), market and languages. LICENSE is the plain GPL-3.0 text; SPDX headers in source
  files. Examples use fictional companies and numbers.

## Earlier versions

- 1.8.4 (2026-10-30) — posting reference numbers and form ids; repeats of applied postings resolved before a batch
- 1.8.3 (2026-10-30) — web UI shows match_score as a 1-10 score, not a percentage
- 1.8.2 (2026-10-30) — web UI fills the viewport, board scrolls inside itself
- 1.8.1 (2026-10-30) — closed postings are checked at scan time and before every batch
- 1.8.0 (2026-10-30) — new job status "skipped": set aside without review, no decision
- 1.7.1 (2026-10-28) — "likely the same posting" between hard duplicates and same-client suspicions
- 1.7.0 (2026-10-27) — default job boards ship with the plugin, config only adjusts them
- 1.6.1 (2026-10-27) — batch switch clears the whole window, apply agents close their tabs
- 1.6.0 (2026-10-22) — language layer: fixed wording from assets/i18n.json (en, pl)
- 1.5.3 (2026-10-22) — replace a batch only after the user verified it and asked for the next
- 1.5.2 (2026-10-22) — accounts on job portals: decision order and structured credentials
- 1.5.1 (2026-10-21) — job-scan time window by last refresh, not first publication
- 1.5.0 (2026-10-20) — report skill for showing postings; batch tab handling
- 1.4.2 (2026-10-20) — postings in batches of ten, rates normalised for tie-breaks
- 1.4.1 (2026-10-16) — job-id query parameters kept in URL matching, the Tab column defined
- 1.4.0 (2026-10-16) — blockers as minuses, comments column, education in profile
- 1.3.0 (2026-09-22) — postings scored against the CV; universal and personal settings split
- 1.2.0 (2026-09-22) — every find checked against the archive before it is reported
- 1.1.0 (2026-09-20) — renamed from recruiter; licence, README, SQLite UI, CDP printing
