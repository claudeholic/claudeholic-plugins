# Changelog

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
