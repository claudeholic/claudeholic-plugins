---
name: job-scan
description: "Skanowanie portali z ofertami pracy (CREK): oferty zgodne z kryteriami kandydata, bez duplikatów z bazy zgłoszeń, w rankingu. Używaj, gdy użytkownik pisze np. „poszukaj ofert”, „przeskanuj portale”, „skanuj”, „nowe oferty”, „co nowego na portalach”, „sprawdź justjoin / nofluffjobs / pracuj.pl”, „znajdź oferty DevOps”. EN: scan job boards for postings matching the candidate's criteria, dedupe against the pipeline database and report ranked candidates. Use when the user asks to search for jobs, scan the boards, check a specific board or find new offers."
---

**Plugin root: `${CLAUDE_PLUGIN_ROOT}`** — commands in `references/*.md` (and in the other CREK skills' references) write `${CLAUDE_PLUGIN_ROOT}`, which is filled in only in this file, not there and not in the Bash tool: always run them with the path above in its place.

# Job scan — finding postings worth applying to

Shares configuration and database with the `apply` skill (`crek.config.json` in the project
root). **First check the config exists**; if it does not, tell the user, offer the bootstrap
interview (`../apply/references/bootstrap.md`) and stop until the config is there — a scan
without criteria has nothing to rank by. Then validate it —
`node "${CLAUDE_PLUGIN_ROOT}/assets/crek-config-check.mjs" crek.config.json` — because a scan run
against a stale inventory or a missing rate floor produces a confident, wrong shortlist.

The pipeline is read and written only through `assets/crek-db.mjs` (any `db.backend`; commands in
`../apply/references/database.md`).

Two references govern the output and are not optional: `../apply/references/scoring.md` for how a
match score is computed, and `../apply/references/reporting.md` for the shape of the report.

## Procedure

1. **Pick the boards: plugin defaults adjusted by the config.** The plugin ships the default
   list in `assets/boards.json` (each board: `key`, `name`, `url`, `region`, `notes`); the
   config's `boards` only adjusts it — `override.<key>` replaces fields of a default (usually
   `url` with the candidate's own filters), `extra` adds boards, `disabled` lists keys to skip.
   Effective list = defaults with overrides applied, then extra, minus disabled, in that order.
   Get it from the script rather than merging by hand:
   `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-config-check.mjs" crek.config.json --boards` prints
   `{"boards": [...], "disabled": [...]}`. Scan every board in `boards`, using its `url` as the
   entry point and its `notes` as known traps. Do not pick boards from memory: that drifts toward
   the same two or three every time. The old config form — `boards` as a plain array — still
   works (entries with `enabled: false` are skipped), but it ignores the plugin defaults; say so
   once and offer to migrate. The report's boards section (`report.section.boards`) lists the
   boards scanned, then the skipped ones under `report.section.boards_disabled` (EN *Skipped —
   disabled in config* / PL *Pominięte — wyłączone w configu*), so the user sees the coverage and
   the gaps. Record each posting's board in the pipeline's `source` column under the board's
   `name`.
2. **Set the time window from the pipeline, not from a guess.** The window starts at the previous
   scan — the newest `found_at` among scan entries in the database (`crek-db.mjs jobs:latest
   --source <board names>`) — minus a day of overlap, and ends now. A posting is in the window when it is **active and was published *or refreshed*
   inside it**: take the newest date the board exposes (justjoin `lastPublishedAt`, pracuj.pl /
   theprotocol the last-publication date, not `initialPublicated`; NFJ `posted` already resets
   on renewal). Never cut by the *first* publication date: boards such as pracuj.pl keep a
   posting live for a month and refresh it, so a posting first published in the gap between two
   scans would never land in any window — and it is still open and still worth applying to.
   Old-but-active postings are what the archive check (step 5) is for: it drops the ones already
   in the pipeline, and whatever is left is new to the user. Entries with `status=skipped` do not
   count as "already in the pipeline": the user set them aside without looking (see step 6).
   Note a repost's first publication date in Comments with `report.value.repost_first_published`
   (EN `repost — first published 24.09` / PL `repost — pierwotnie 24.09`), but keep it in the
   list.
3. **Browse, don't curl** — boards 403 plain HTTP clients. Apply the board's own filters
   first (category, remote, contract type, salary) to cut the volume; listing pages usually
   lazy-load — scroll in a loop while collecting links. The whole scan runs in **one browser
   window** — set it up before the first board and before any agent starts (*One browser window
   per scan* below).
4. **Title-level triage** (cheap): drop only what is plainly not the user's kind of role — a role
   family in `criteria.soft.role_families.avoid`, or a posting closed to the candidate's country.
   Postings that fail a blocker (wrong contract form, work mode, rate, a reject-listed core
   technology) are **kept**: they are scored with the blocker as a minus, per `scoring.md`,
   and the user decides. Keep the list of what you did drop and why — it goes into the report.
   **A posting that is closed** — no longer accepting applications, expired, archived, removed —
   is dropped too, whatever its score would be: the user cannot apply to it. Boards keep closed
   postings on the same URL and some still list them in search, so check the board's closed
   markers wherever the page shows them (LinkedIn: "No longer accepting applications" / PL
   "Kandydaci nie są już akceptowani", or what the `linkedin-mcp` tools report — see *LinkedIn*
   below; the per-board markers are in the `notes` of `assets/boards.json` and in
   `assets/crek-closed-check.mjs`, see *Closed postings* below).
   It goes into the dropped section with the reason (`report.value.closed`, EN `closed — no
   longer accepting applications (checked 30.10 14:20)`) and is not recorded as `new`.
5. **Archive check — run it on the whole shortlist before reading anything in depth.**
   Feed every shortlisted posting to `assets/crek-match.mjs` (see below) and read what comes
   back. The same role reaches the market through several agencies under different titles and
   URLs, so a link comparison finds nothing; what works is reading the handful of archive
   entries that sit in the same corner of the pipeline. Doing this before the deep read also
   stops you from re-reading postings you already analysed weeks ago.
6. **Deep read what survived**: open each posting, extract the full picture (hiring company
   vs agency, salary, work mode fine print — "remote" sometimes means "remote within country
   X", benefits pages reveal hybrid expectations) **and every posting reference number** — in
   the body and on the apply target, i.e. where the "Apply" button leads (see *Reference
   numbers* below). **First check that it is still open** — the
   board's closed markers (see *Closed postings* below); a closed posting is dropped as in
   step 4, not scored. Then score it by `../apply/references/scoring.md`:
   remaining blockers first, then coverage of the posting's mandatory requirements by
   `profile_inventory`. Write down which requirements are covered, which are partial and why, and
   which are missing — those three lists are what the report prints, so collecting them here costs
   nothing later. Then **run `crek-match.mjs` again on the deep-read postings with their refs**
   (`refs`, `apply_url`; the title-level run in step 5 had none) — that is what turns "same
   title at Northwind" into "same `JOB-7K2QX`, applied 22.10". Repeats come in three levels:
   - **Hard duplicate** (`!!` — same URL, reference number or application-form id): the only
     thing recorded as `status=duplicate, duplicate_of_id=<id>`, with a dated note naming the
     shared ref (`note.duplicate` from `assets/i18n.json`, e.g. EN `30.10.2026: hard duplicate of
     #812 — shared: JOB-7K2QX, greenhouse:7712345` / PL `30.10.2026: twardy duplikat #812 — wspólne:
     JOB-7K2QX, greenhouse:7712345`).
     "Same URL" compares addresses without tracking parameters (`utm_*`, `trk`, `refId`, …) but
     with every other one, so two eRecruiter `WebID`s or two Greenhouse `token`s stay different.
     A shared URL that proves nothing — the same URL under two different companies, or the same
     ATS form address with no shared posting id — is marked `!` with `match.same_url_other_company`
     / `match.same_url_no_id` (`"url_suspect": true` in `--json`): never a duplicate, check it.
   - **Likely the same posting** (`!` — same agency, same normalised title, overlapping rate;
     title and agency alone when one side has no rate, and say so): stays in the list, scored
     as usual, but Comments use `report.value.likely_same_posting` (EN `likely the same posting
     as #503 Tailspin, applied 16.10` / PL `najpewniej to samo ogłoszenie co #503 Tailspin, applied
     16.10`) and, when that entry was already applied to, the suggestion is
     `report.value.suggest_skip` — it is the same recruitment.
   - **Possibly the same client** (an archived role apparently reposted by another agency):
     stays in the list, scored as usual, with `report.value.possibly_same_client` in Comments
     (EN `possibly the same client as #71 Litware, applied 12.09, no response` / PL `możliwie ten
     sam klient co #71 Litware, applied 12.09, bez odpowiedzi`).

   Only the first is removed; the user decides on the rest — a good role applied to twice is
   better than a good role lost.

   **Previously skipped** (`status=skipped` — set aside without review, no decision; marked `~~`
   / `~` by `crek-match.mjs` instead of `!!` / `!`). A skipped entry is never a reason to drop a
   posting, never a reason to suggest skip, and never "already declined": the posting is
   presented **as new**, scored as usual, with `report.value.previously_skipped` in Comments (EN
   `previously skipped without review (#123, 30.10)` / PL `wcześniej pominięte bez przeglądu
   (#123, 30.10)`; the date is when it was skipped, from `notes`). Chosen handling:
   - **Same URL or reference number (`~~`)** → no new row: **reuse the skipped row** — set it back
     to `status=new`, refresh what changed (description, rate, score, technologies) and append to
     `notes` the date and `note.back_to_new_seen_again` (EN `back to new — seen again in a scan,
     previously skipped without review` / PL `wraca do new — znów w skanie, wcześniej pominięte bez
     przeglądu`). One row per posting, its history in one place.
   - **Likely the same posting or possibly the same client (`~` or an unmarked line)** → record
     the posting as its own `new` row as usual; the skipped entry stays `skipped` and is only
     named in Comments.

   **Previously closed** (`status=closed` — the employer stopped taking applications; `crek-match.mjs`
   leads the reason with `match.previously_closed`). A hard hit (same URL or reference number) on
   a closed row is the same posting: if it is still closed, drop it (step 4); if the board shows
   it **active again**, it reopened — **reuse the closed row**: back to `status=new`, refresh what
   changed, append to `notes` the date and `note.back_to_new_reopened` (EN `back to new — reopened
   by the employer` / PL `wraca do new — pracodawca znów przyjmuje zgłoszenia`). A likely-same or same-client hit on a closed
   row is only named in Comments; a closed posting is never a minus on anything.

   **Company-level penalties.** `criteria.blockers.exclude_rejecting_companies` counts only
   `status=rejected` — the employer said no. `declined` is the candidate's no to **that one
   posting** and says nothing about the company; `skipped` says nothing at all. Neither is a minus
   on the company's other postings.
7. **Record** every kept posting with `crek-db.mjs jobs:add` as `status=new` with full analysis
   in `description`, technologies as JSON array, and `match_score`. The refs found in step 6 go into `description`
   as one line of its own, `REF: JOB-7K2QX; greenhouse:7712345` (format: *Reference numbers* below), and
   the apply target into `apply_url` when it is not the board's own form. Postings rejected for interesting reasons
   are worth recording as `declined` + reason, so future scans recognise **that posting** as
   already declined (it is a ruling on the posting, not on the company). `skipped` rows are the
   opposite: future scans bring them back as new (step 6).
8. **Report** using the table and sections from `../apply/references/reporting.md` — columns
   EN `Tab | Posting | Rate | Match | Pros | Cons | Comments` / PL `Tab | Oferta | Stawka |
   Dopasow. | Plusy | Minusy | Komentarze` (headers and standard values from
   `assets/i18n.json` in the resolved presentation language), in batches of ten (see
   *Batches of ten* there) — every kept posting is eligible, blockers and suspected repeats
   included as Cons and Comments, but the first report shows the top ten, then hard duplicates
   already in the pipeline, then two or three sentences of verdict, then the list of boards
   scanned and the boards skipped as disabled. Pros and Cons carry covered and missing requirements, not opinions. Recommend an
   attack order and STOP — applying is the `apply` skill's job, on the user's go. Every later
   batch, re-shown table or summary is the `report` skill's job. **Right before printing the
   first batch, check its open tabs for closed postings** exactly as the report skill does
   before every batch (*Closed postings* in reporting.md): hours pass between the deep read and
   the user's look, and postings close in between.
   **Alongside it, resolve likely repeats** of anything already applied to (*Repeats of
   applied postings* in reporting.md, `assets/crek-dedupe-check.mjs`): a proven repeat becomes
   `duplicate`, a likely one goes under the table in "Already in the pipeline", and neither is a
   row the user is asked to rule on.

## One browser window per scan

In chrome-shared every new `isolatedContext` name opens a new Chrome window. A scan split across
agents, each picking its own name, pops up one window per agent over the user's work. Keep the
whole scan in one window, whether it runs in agents or in this session alone. The one exception is
the login-board agent (point 4): it needs the user's logged-in profile, so its tabs open in the
user's regular browser window — two windows in all, never one per agent. This is a rule for you to
follow; nothing in the plugin enforces it.

1. **Anchor tab first.** Before the first board and before any agent starts, the main session
   opens one tab: `new_page` with `url: "file://${CLAUDE_PLUGIN_ROOT}/assets/crek-anchor.html"`
   and `isolatedContext` set to a name unique to this scan, `crek-scan-YYYYMMDD-HHMM` (e.g.
   `crek-scan-20261103-2130`). Context names are shared by every Claude session on the computer,
   so a generic name such as `crek-scan` can land in another session's window. This tab opens the
   scan's window and holds it open; note its `pageId`. The page tells the user in large letters
   not to close it (title "CREK Anchor — do not close"; English with a Polish line). If it does
   not load, use `about:blank` as the anchor and go on.
2. **Every board page in that context, in the background.** `new_page` with the same
   `isolatedContext` and `background: true`: the tab joins the anchor's window and does not come
   to the front. Never another context name — that is another window; and never a board page
   without `isolatedContext` — that is the user's own profile, where cookie consent is clicked in
   their name (the login-board agent of point 4 is the one exception). Work only on the
   `pageId`s you opened (the `new_page` reply marks the new tab `[selected]`), and close your tabs
   when a board is done.
3. **Give every other agent the name and the rules.** Paste this into the prompt of each scan
   agent except the login-board one (point 4), with the context name and the anchor's `pageId`
   filled in:

   > Browser: only the chrome-shared tools (`mcp__plugin_chrome-shared_browser__*`). Open tabs only
   > with `new_page` with `isolatedContext: "<crek-scan-…>"` and `background: true` — never another
   > context name, never without `isolatedContext`. Work only on the `pageId`s you opened (the
   > `new_page` reply marks your new tab `[selected]`); every other tab belongs to someone else.
   > Close your tabs with `close_page` when you finish each board. Never close the anchor page
   > (CREK Anchor, page `<anchor pageId>`) — it holds the window. Do not open LinkedIn, Indeed or any
   > board that needs a login, in the browser or through LinkedIn MCP tools — another agent does
   > those. Do not start agents of your own.

   If the window disappears anyway (the anchor closed by mistake), the next `new_page` in the
   context opens a new one: that tab becomes the anchor. Do not open a second window next to it.
4. **Boards that need a login: one agent of their own, in parallel with the others.** LinkedIn,
   Indeed and any other board where the scan needs the user's cookies or session go to **one**
   separate agent, the login-board agent, started together with the other scan agents (when the
   rest of the scan runs in this session alone, start it alongside your own boards). It is the
   only one that touches LinkedIn and Indeed in this scan: no other agent does, and the main
   session leaves them alone while it runs. It works in the default context (no
   `isolatedContext`, the shared logged-in profile), opening every tab with `new_page`
   `background: true` — the tabs land in the user's regular window, not the scan's, without coming
   to the front. That window holds the user's own tabs, so the agent works only on the `pageId`s it
   opened and closes them itself. One posting at a time, with pauses; it may use the
   `linkedin-mcp` tools when they are in the session (*LinkedIn* below).
   - **A login page** — in chrome-shared, in the second browser, on any board (a logged-out
     LinkedIn page, Indeed asking to sign in): when the config has that portal's login
     (`credentials.<portal>`, e.g. `credentials.linkedin`, with a password), the agent signs in
     with it, as in *LinkedIn* in `../apply/references/ats-playbook.md`. No stored password, or
     the password does not get it in: a block (next point).
   - **A block** — a CAPTCHA, a security check, a verification, a code sent by SMS or e-mail, a
     warning, a login page it cannot get past: the agent never solves or clicks through it. If
     the config has a second browser (`browser.cdp_fallback_port`, the fallback browser of
     *Anti-bot / invisible reCAPTCHA escalation* in the ats-playbook) and that browser answers on
     the port, the agent tries the same board again there, to see whether the check comes back:
     same pace, its own tabs only, a login page there handled as above. No check there — it
     finishes the board there. Blocked there too, or no second browser (no port in the config, or
     nothing answering on it) — it stops that board, goes on with the next one and says so in its
     report.
   - **`linkedin-mcp` opens its login window** (its session expired): that window is the server's
     own browser (a Patchright-managed Chromium). None of the agent's tools reach it — the
     chrome-shared tools drive only the chrome-shared browser, the second browser is another
     program, and the server has no tool for signing in — so the agent cannot sign in there, even
     with `credentials.linkedin`. It leaves the window alone, stops using those tools, says so in
     its report and goes on with LinkedIn in chrome-shared.

   The agent never asks the user anything — that is the main session's job. When its report names
   a stopped board, ask the user what to do (sign in or pass the check themselves, start the
   second browser, or leave the board out), list the board in the scan report as not finished,
   and resume it — in a new login-board agent with the same rules, or yourself — only on the
   user's answer. Paste this into the login-board agent's prompt, with the boards, the port
   (`browser.cdp_fallback_port`, or `none`) and the scan's context name filled in:

   > Browser: the chrome-shared tools (`mcp__plugin_chrome-shared_browser__*`), the `linkedin-mcp`
   > tools if they are in your tool list, and — only after a block, below — the second browser on
   > port `<cdp_fallback_port | none>`. You are the only agent in this scan that touches these
   > boards: `<LinkedIn, Indeed, …>`. Open tabs only with `new_page` with `background: true` and
   > **without** `isolatedContext` — the shared logged-in profile; never the scan's context
   > `<crek-scan-…>`. Your tabs open in the user's own window, next to the user's tabs: work only
   > on the `pageId`s you opened (the `new_page` reply marks your new tab `[selected]`); never
   > select, navigate, reload or close any other tab. Close your tabs with `close_page` as soon as
   > you are done with them. One posting at a time, a few seconds' pause between pages, only the
   > pages you need; no LinkedIn API, no scripts or bulk requests against any board. Cookie
   > banners: "reject" / "only necessary" first, "accept" only when nothing else is offered —
   > consent here is given in the user's name. A login page, in either browser: sign in with that
   > portal's entry in `credentials` in `crek.config.json` (`credentials.linkedin` for LinkedIn)
   > when it has a password; never copy the password into a command line, a prompt or your report.
   > No stored password, or it does not get you in → a block. If `linkedin-mcp` opens its login
   > window, leave it alone — your tools cannot reach that browser: stop using its tools, say so in
   > your report, go on in chrome-shared. **A CAPTCHA, a security check, a verification, a code by
   > SMS or e-mail, a warning or a login page you cannot pass is a block: never solve it, never
   > click through it.** On a block, if a port is given and `http://127.0.0.1:<port>/json/version`
   > answers, try that board again in the second browser over CDP, as crek's
   > `skills/apply/references/ats-playbook.md` describes for the fallback browser (*Anti-bot*):
   > `PUT /json/new?url=…`, read the text with `Runtime.evaluate`, type with `Input.insertText`
   > (a script that reads the password from the config itself), close your tab with
   > `/json/close/<id>`; only tabs you opened. No block there → finish the board there. Blocked
   > there too, or no second browser → stop that board and go on with the next. Report the postings as asked and, for every board you stopped: what blocked
   > it, on which page and when, whether the second browser was tried and what it showed, and
   > which postings are left. Do not ask the user anything. Do not start agents of your own.

5. **End of the scan.** When the last agent has reported, the login-board agent included (or your
   own last board is done), list the pages and close every tab still open in the scan's context
   **except the anchor**. The window stays: the batch the user looks at opens in it (*The batch
   window* in `../apply/references/reporting.md`), and the anchor is closed only when the user is
   done with the batches.

## Closed postings (`assets/crek-closed-check.mjs`)

Postings close at any time — LinkedIn ones within hours of being found. A posting that was open
in the morning's deep read can show "No longer accepting applications" (PL "Kandydaci nie są już
akceptowani") by the time the user opens its tab, so "open" is checked twice: at scan time
(steps 4 and 6) and right before a batch is printed (reporting.md, *Closed postings*). The
script makes the check the same every time:

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-closed-check.mjs" --tabs 241,242,243 --config crek.config.json
echo '[{"id":1188,"url":"https://www.linkedin.com/jobs/view/4123456789/"}]' \
  | node "${CLAUDE_PLUGIN_ROOT}/assets/crek-closed-check.mjs" --urls - --json
```

- `--tabs` reads tabs that are already open (by their `[N]` title prefix): the page text only.
  Read only — no navigation, no clicks, no reload, no site API.
- `--urls` checks a list (`id` + `url`, or CREK rows with `source_url`) in one tab of its own,
  with a pause between postings (`--delay`, default 1500 ms), and closes that tab at the end.
  **LinkedIn URLs are not opened** by the script — they come back `unknown`; check them as in
  *LinkedIn* below.
- One verdict per posting: `closed` with the evidence (the matched phrase, `HTTP 404`, a
  not-found redirect), `open` (a board with known markers and none found — never on LinkedIn),
  `unknown` (a board without known markers, a LinkedIn page without a known phrase, a bot check,
  an error). `unknown` means "look at the page yourself", never "open".
- The script's phrases per board (`assets/crek-closed-rules.mjs`; for humans, the `notes` of
  `assets/boards.json`) are a **fast path, not the definition of closed**. `closed` from the
  script is final. Anything else — `unknown`, and `open` on a board judged by its phrases alone —
  means: read the page and judge what it says. "Ogłoszenie wygasło", "This job is no longer
  available", "Rekrutacja zakończona", an Apply button that is gone or disabled — closed, in any
  wording. Recognise it by reading, every time; **never add a phrase** to the script,
  `boards.json` or the config (the list is changed only by the plugin's developers).

At scan time the page you read anyway is usually enough — NFJ / theprotocol / bulldog / pracuj.pl
say "wygasła" / "Job expired" / "zakończył zbieranie zgłoszeń" in the body you read in step 6,
and a LinkedIn posting says "No longer accepting applications" next to its title. The script is
for when you have only URLs or tabs.

### LinkedIn

CREK calls no LinkedIn API of its own. A LinkedIn posting is checked in one of two ways:

- **The `linkedin-mcp` plugin is installed and configured** (its tools are
  `mcp__plugin_linkedin-mcp_linkedin__*`, or `mcp__linkedin__*` from a manually configured
  server — check that they are in your tool list): use its tools — the posting's details
  (`get_job_details` with the job id from the URL) for the body, the refs and whether it still
  takes applications. Read what the tool returns; a closed posting says so in its text.
- **It is not** (or a tool fails, or lacks what you need): open the posting in the shared browser
  (chrome-shared) like a person would — one tab, let it load, scroll, click "See more" / "Pokaż
  więcej" when the description is folded, and read the text. "No longer accepting applications" /
  "Kandydaci nie są już akceptowani", an Apply button that is gone or disabled — closed. The
  external Apply button opens the employer's form in a new tab: click it when you need the apply
  target (refs, `apply_url`), read the URL, close that tab.

Either way, during a scan it is the login-board agent's part and no one else's (point 4 of *One
browser window per scan* above); after the scan — the closed check before a batch — it is the main
session's, with no scan agents running. And either way: no scripted requests to LinkedIn, no bulk
page loads — LinkedIn restricts accounts that look automated. Open only the postings you need, one
at a time, with pauses between them. A logged-out page is handled as in *LinkedIn* in
`../apply/references/ats-playbook.md`; on a CAPTCHA, a security check or a warning, never solve or
click through it on your own: in a scan the login-board agent retries that board in the second
browser and otherwise reports it (point 4), outside a scan stop and tell the user.

## Reference numbers (`assets/crek-refs.mjs`)

A posting copied to another board keeps its reference number and its application form, even when
the title, the URL and the agency's wording change. Say LinkedIn #1204 "Build and Release
Engineer" (Northwind Consulting) says "Job no. JOB-7K2QX" in its body and its "Apply" leads to
`job-boards.greenhouse.io/northwind/jobs/7712345` — the same number and the same form as #812 from
pracuj.pl, applied to a week earlier. Without the refs crek-match sees only title + company (`!`),
and the user is asked to decide on something already sent. So in the deep read collect:

- **from the body**: labelled numbers — "Job no. / Job ID / Req ID / Requisition ID / Reference
  number / Ref. / Nr ref. / Numer referencyjny / Nr oferty / ID oferty / Kod oferty", Traffit's
  bare "ID: 123" — and known formats (Sii `JOB-XXXXX`, Workday `R-12345` / `JR123456`);
- **from the apply target** (the URL behind "Apply" / "Aplikuj"; on LinkedIn the page the external
  Apply button opens, or the `safety/go?url=` link — see *LinkedIn* above): the ATS form or job id — Traffit
  `/public/form/a/<hash>` and `thankyou/<id>`, eRecruiter `WebID=`, Greenhouse `/jobs/<id>` or
  `gh_jid=`, Lever / Ashby / Recruitify job uuid, SmartRecruiters publication id, Workday
  `_R-12345`, darize `assignments/<id>`, Personio `/job/<id>`, Workable `/j/<id>`, pracuj.pl
  `,oferta,<id>`, Sii `id/<n>`.

Where to look on each board: the board's `notes` in `assets/boards.json`. The patterns in
`assets/crek-refs.mjs` (`extractRefs` over text, `urlRefs` over URLs) are a fast path too: a
reference number or form id they miss — a new ATS, a label in other words — you still recognise by
reading, and write into the `REF:` line yourself (*Storage* below). Do not edit the plugin's files.

**Storage.** The schema has no ref column, so refs live in `description` as **one line of their
own**: `REF: ` then entries separated by `; `, each `kind:value` for an ATS / site id or the bare
value for a reference number — `REF: JOB-7K2QX; greenhouse:7712345; traffit:48213`. Kinds are the names
used in crek-refs.mjs (`traffit`, `erecruiter`, `greenhouse`, `lever`, `ashby`, `smartrecruiters`,
`recruitify`, `darize`, `workday`, `sii`, `personio`, `workable`, `pracuj`, …). Nothing else
changes: crek-match also reads refs from every row's notes, communication, apply_url and
source_url, so older rows (a "form ID 48213" in an application log) count as well.

**Matching** is on the normalised value (lowercase, letters and digits only: `JOB-7K2QX` =
`job7k2qx`); a bare reference number matches any kind, an ATS id only the same ATS. A short
purely numeric id (under 6 digits — Traffit form 48213, a site id like 10042) is a hard hit only together
with the same company, since such numbers repeat across ATS tenants; otherwise it is only named.

## Archive check (`assets/crek-match.mjs`)

```bash
echo '[{"title":"Platform Engineer (Kubernetes)","agency":"Initech",
       "tech":["Kubernetes","Terraform"],"url":"https://...","salary":{"min":150,"max":170,"unit":"hour"},
       "location":"Warszawa"}]' \
  | node "${CLAUDE_PLUGIN_ROOT}/assets/crek-match.mjs" --config crek.config.json
```

Pass the whole shortlist in one call — the script reads the pipeline once per run (no cache, so
a row recorded a minute ago is always there).
Only `title` is required; every extra field (tech tags, URL, rate, location, posting reference
number) sharpens the ranking. After the deep read pass the refs too — `"ref": "JOB-7K2QX"` or
`"refs": ["JOB-7K2QX", "greenhouse:7712345"]`, `"apply_url"` (the apply target), optionally `"text"` (the
body; refs are extracted from it) and `"id"` when the posting already has its own row (it is never
matched against itself):

```bash
echo '[{"title":"Build and Release Engineer","agency":"Northwind Consulting",
       "url":"https://www.linkedin.com/jobs/view/4123456780/","ref":"JOB-7K2QX",
       "apply_url":"https://job-boards.greenhouse.io/northwind/jobs/7712345"}]' \
  | node "${CLAUDE_PLUGIN_ROOT}/assets/crek-match.mjs" --config crek.config.json
#   !! #812 | Build and Release Engineer (f/m/x) | Northwind Consulting | applied | … | ref JOB-7K2QX; same application form greenhouse:7712345; …
```

For each candidate it prints the closest archive entries, one line each, with id, status, date and
what they share. Its messages follow the config's
`presentation.language` (`--lang pl|en` overrides it, and so does env `CREK_LANG` when there is no
`--lang`; unknown → English);
`--json` keeps the same keys in every language.

It returns **no verdict, by design**. Token weights come from the pipeline itself — a word
common across archived titles ("engineer") counts for almost nothing, a rare one ("zephyr")
counts for a lot — so the output is a shortlist to read, not a decision. Recognising that
"payment-gateway migration for a retail bank" means the client from an entry recorded two
months ago is your job; the script only guarantees the material lands in front of you every time, including
when nobody thought to go looking.

Lines marked `!!` are hard hits (same canonical URL, same posting reference number or the same
application-form id — `match.ref`, `match.same_form`) — those are duplicates without further
discussion. A hit on a row that is itself a duplicate names the row it points at
(`match.duplicate_of`); `--json` gives `root_id` / `root_status` for it, plus `shared_refs` and,
per candidate, `candidate_refs`. Lines marked `!` are *likely the same posting*: the
same agency or company and the same title once case, punctuation, gender suffixes (`(m/f/d)`)
and a trailing tech list after ` — ` / ` - ` / `|` are ignored (or one title contains the
other), with overlapping rates — or no rate on one side, which the reason then says. That is
almost certainly the same recruitment posted on another board: not auto-recorded as a
duplicate, but worded with `report.value.likely_same_posting` and suggested skip when the
earlier entry was applied to. In `--json` these carry `"likely_same_posting": true` and
`"likely_same_posting_rate": "overlap"|"missing"`. Everything else is at most a suspicion: it
goes into Comments and never removes a posting from the report.

Hits on an entry with `status=skipped` are marked `~~` (same URL or reference number) and `~`
(likely the same posting) instead of `!!` / `!`, and their reason starts with
`match.previously_skipped` — the user set that entry aside without review, so it carries no
decision: not a duplicate, no skip suggestion, present the posting as new (step 6). In `--json`
they carry `"previously_skipped": true`; `exact` and `likely_same_posting` still describe the
match itself.

## Presenting pages to the user

When you open postings for the user to look at, the pages must be ready to read — no overlays,
no cookie banners, no login walls. Before reporting the tab list:

- **Cookie / consent banners** — dismiss them in this order: "reject" / "only necessary" /
  "Odrzuć" / "Tylko niezbędne" first; when there is no such button, "close" / X; "accept" only
  when the banner offers nothing else (the shared profile is the user's — consent clicked there
  is consent given in their name). A page with a banner covering half the screen is not "open".
- **Which window** — a batch opens in the batch window: the scan's window with its anchor, or a
  window of its own when there is no scan window (*The batch window* in
  `../apply/references/reporting.md`), so the user finds the batch in one place and not among
  their own tabs. Postings that need the user's login to show — LinkedIn, Indeed and the like —
  are the exception: they open in the shared browser context (no `isolatedContext`), where the
  user is signed in. A batch-window tab has no cookies, so its consent banner comes back every
  time: dismiss it as above.
- **Any other overlay** (newsletter signup, app-install prompt, GDPR popup) — close it.

The user navigates by the tab numbers you report (positions in the batch window, `[N]` in the
shared context — *The table* in reporting.md). A tab that requires two clicks before the
content is visible is a tab that wastes their time.

## Watch-outs

- "Fully remote" US startups often mean "remote (US)" — check location eligibility before
  getting excited; company career pages list per-role location constraints.
- Salary shown by aggregators can be a bad currency conversion or the wrong contract type —
  verify against the posting body ("gross/month" usually signals employment, not B2B).
- Note application deadlines — they decide the attack order.
- If the user asked about a niche (e.g. "roles requiring Rust"), search postings'
  full text for the niche keywords, not just titles; boards' own search covers bodies.
