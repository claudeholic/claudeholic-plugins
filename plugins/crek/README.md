**English** | [Polski](README.pl.md)

# CREK — job hunt pipeline for Claude Code

CREK (Claude Rekrutacje) is a Claude Code plugin for people looking for a job. You stay the
candidate and make the decisions. Claude does the legwork: it scans job boards, scores postings
against your CV and criteria, shows them in one table, tailors a CV per posting, fills the
application form in a real browser and keeps every application in a database, so the next
session knows what was sent, where and when.

> **Made for the IT job market in Poland.** CREK works in Polish and in English, but its default
> job boards, form know-how and contract types are Polish. In another country it can be less
> effective: boards from other countries can be added in theory, but it is not straightforward —
> see [Job boards and using CREK outside Poland](#job-boards-and-using-crek-outside-poland).
>
> **Polish commands come first.** Skills start on phrases from their descriptions. The main
> phrases are Polish, the English ones are an addition, and Claude Code does not translate them —
> see [Commands](#commands).

**Operating system.** CREK itself is not tied to Linux and also runs on Windows. The limit is its
dependency `chrome-shared` (installed automatically) — the browser in which CREK scans boards,
fills forms and checks tabs — which runs only on Linux. Under WSL it should work, but this has not
been tested. On Windows, `chmod 600` does not protect the config and the database file, and the
config check may warn about their permissions every time.

## What it does

- **Scans job boards** — 25 boards by default (Polish IT boards, global remote boards, freelance
  marketplaces, searches on startup ATS sites). It drops what is plainly not your kind of role,
  reads the rest and checks each find against everything you have already seen.
- **Scores each posting against your CV** — the score (1–10) is the share of the posting's
  mandatory requirements that your master CV covers, computed the same way every time. Your hard
  criteria (contract type, minimum rate, work mode, technologies you refuse) are checked too: a
  failed one costs a point and is listed first under Cons. The posting stays in the list — you
  decide whether it ends it.
- **Shows postings in one table, ten at a time** — `Tab | Posting | Rate | Match | Pros | Cons |
  Comments`. Every posting in the batch is open in the browser; the Tab column is the tab number.
  Pros and Cons are covered and missing requirements, not opinions. Comments carry your earlier
  decisions and Claude's suggestion.
- **Catches repeats and closed postings** — the same job often comes back through another board
  or agency. CREK compares URLs, reference numbers, the boards' own posting numbers (nofluffjobs
  gives every city of a posting its own URL, but one reference) and application-form ids; a proven repeat is
  recorded as a duplicate, a likely repeat of something you applied to is listed under the table,
  a weaker suspicion is noted in Comments. Postings are checked for "no longer accepting
  applications" when scanned and again right before a batch is shown.
- **Tailors a CV per posting** — reorders and rephrases what your CV already says to fit the
  posting. Each variant is a small Python script that renders HTML, printed to PDF.
- **Fills application forms** — Ashby, Greenhouse, Traffit, Personio, eRecruiter, Pracuj.pl,
  LinkedIn and plain forms, each with its known traps written down. It copies data from your CV
  into the form; answers where tone matters are drafted for your approval first.
- **Keeps the pipeline** — one row per posting: status (new, applied, interview, offer, rejected,
  declined, skipped, closed, duplicate), rates, the CV that went out, contacts and a dated log of
  what was said. An optional web UI shows the same data.

## Requirements

| What | Why | Needed |
|---|---|---|
| Linux — for `chrome-shared` | `chrome-shared` uses Linux-specific tools and does not support macOS or Windows; CREK's own scripts are not Linux-specific. Under WSL it should work, but this has not been tested | in practice always: scanning, forms and closed checks run in that browser |
| [Claude Code](https://code.claude.com) with your own account | runs the skills | always |
| Node.js **>= 22.13** | the scripts (built-in `fetch`, `WebSocket`, `node:sqlite`) | always (>= 22 is enough without SQLite) |
| `chrome-shared` plugin **>= 1.3.2** | the browser CREK reads boards and fills forms in (CDP port 9226, `[N]` tab numbers) | always — installed as a dependency |
| Python 3 | builds CV variants (`assets/cv-template/build_cv.py`) | to tailor CVs |
| `pdftotext` (poppler-utils) | reads the master CV | recommended — otherwise the CV is read in the browser |
| `pdftk` | removes the tab number from the PDF Title metadata | optional — a warning says when it is missing |
| `mysql` / `mariadb` client | talks to a MySQL / MariaDB database | only for `db.backend: mysql` |
| PHP >= 7.4 (8.x recommended) with `pdo_sqlite` or `pdo_mysql` (Debian/Ubuntu: `php-cli php-sqlite3`) | the optional web UI | only for the UI |
| MySQL >= 5.7.22 or MariaDB >= 10.5 | a MySQL database | only for `db.backend: mysql` or a hosted UI on MySQL |
| `linkedin-mcp` plugin | LinkedIn tools for Claude | optional, recommended |

The plugin installs nothing by itself — no npm packages, no downloads. It uses Node's built-in
modules and the programs above.

## Install

```
/plugin marketplace add claudeholic/claudeholic-plugins
/plugin install crek@claudeholic-plugins
```

`chrome-shared` comes along as a dependency. Optional, but recommended:

```
/plugin install linkedin-mcp@claudeholic-plugins
```

It gives Claude LinkedIn tools (search, postings, profiles, messages) through your own LinkedIn
session. Without it, every LinkedIn step goes through the browser and still works.

Start Claude Code in a directory of its own (for example `~/job-hunt`). CREK keeps its config,
database and CVs there.

## Example session

Commands are typed into Claude Code. Numbers in commands are tab numbers from the table.

**1. First run.** You type `scan the boards`. Every CREK command first looks for
`crek.config.json`; there is none, so Claude offers a short interview and does nothing else until
the config exists. First it checks whether the `linkedin-mcp` plugin is installed and, if not,
suggests it (recommended, not required), then asks whether to store your LinkedIn login and
password in the config for Claude to use in the browser when its LinkedIn session is missing
(optional; the password reaches the model like the rest of the config). Then it asks, a few
questions at a time: the language of reports, your contact data, hard criteria (contract types,
minimum rate, work modes, technologies you refuse), soft criteria, how to quote your rate, where
your master CV is, what to answer when a form asks whether AI was used, whether Claude may create
portal accounts on its own, and which database to use (SQLite by default). Then it reads your CV,
builds the skill inventory that scores come from, writes `crek.config.json` (readable by you only)
and creates the database.

**2. Scan.** `scan the boards` again. Claude opens the boards in the shared browser, applies their
filters, reads the shortlisted postings, checks them against the database, scores them and
records them as `new`. It is real browsing, page by page, so it is not instant. Boards you are
signed in to (LinkedIn, Indeed and the like) go to one agent of their own, which browses them like
one person: one tab and one action at a time, scrolling with pauses of a few seconds — through as
many result pages and postings as the scan needs, never several at once.

**3. The table.** The first ten postings are open as tabs, and you get:

| Tab | Posting | Rate | Match | Pros | Cons | Comments |
|---|---|---|---|---|---|---|
| 21 | Contoso — Platform Engineer | 160–190/h | 8 | Kubernetes, Terraform, AWS | GitHub Actions (GitLab CI only) | apply |
| 22 | Initech — DevOps Engineer (Fabrikam) | 22–26k/mo | 7 | CI/CD, Linux, Ansible | employment contract only | apply |
| 23 | Northwind — SRE | not disclosed | 6 | Prometheus, Kubernetes | Go, on-call 24/7 | previously skipped without review (#412, 28.10) |
| … | | | | | | |

Under it: postings already in the pipeline, a short verdict (what to apply to first and why) and
the boards scanned. The count says how many are left (`10 of 37`).

**4. Your decision.** `send 21 and 24, decline the rest`. Postings 21 and 24 go to the
application step; the other eight in this batch become `declined`. Nothing outside the batch
changes.

**5. Applying.** For each posting Claude checks the archive once more, picks or builds a CV
variant, opens the form and fills the standard fields from your config. A new CV variant and any
free-text answer (motivation, "in your own words") wait for your approval. The application counts
as sent only when the page confirms it. Claude then reports what went where, with which CV and
rate, and records it in the database.

**6. More postings.** `next 10` closes the old tabs and opens the next batch. `skip the rest` sets
the remaining postings aside without a decision (`skipped`) — if a later scan finds them again,
they come back as new. "Decline" and "skip" differ on purpose.

**7. What was sent.** `what did we send` prints the same table for postings you applied to. The
optional web UI shows the whole pipeline too.

**Later:** `evaluate this posting: <link>` for a single posting, `handle this recruiter's offer`
when a recruiter writes to you, `I updated my CV` after you change your CV.

## Commands

| Skill | What it does | Polish phrases (main) | English phrases |
|---|---|---|---|
| `crek:job-scan` | scans the boards | „poszukaj ofert”, „przeskanuj portale”, „skanuj”, „nowe oferty”, „co nowego na portalach”, „sprawdź justjoin / nofluffjobs / pracuj.pl”, „znajdź oferty DevOps” | search for jobs, scan the boards, check a specific board, find new offers |
| `crek:report` | shows postings from the database, records your decisions on a batch | „pokaż tabelę”, „otwórz pierwsze 10”, „co wysłaliśmy”, „pokaż wysłane”, „ile wysłaliśmy”, „status zgłoszeń”, „co jest otwarte”, „X wyślij, reszta odrzuć” | show the table, open the first 10, summary table, what did we send, what is open, send X, decline the rest |
| `crek:apply` | one posting end to end: score, CV, form, database | „aplikuj”, „wyślij CV”, „wyślij zgłoszenie”, „oceń ofertę”, „czy ta oferta pasuje”, „przeanalizuj ogłoszenie”, „rekruter się odezwał”, „odpowiedz rekruterowi” | apply to a job, send the application, evaluate a posting, handle a recruiter's offer |
| `crek:profile` | reads your master CV and rebuilds the skill inventory | „zmieniłem CV”, „zaktualizowałem CV”, „przeczytaj CV od nowa”, „odśwież profil umiejętności” | I updated my CV |
| `crek:browsers` | shows, changes and verifies the browsers CREK uses (in order, with fallbacks) and the mailbox access for verification codes | „skonfiguruj przeglądarki”, „sprawdź przeglądarki”, „dodaj przeglądarkę zapasową”, „zmień kolejność przeglądarek”, „dostęp do maila” | set up browsers, check the browsers, add a fallback browser, mail access |

Short commands — „następne” / "next", „kolejne 10” / "next 10", „pomiń resztę” / "skip the rest",
„zignoruj resztę” / "ignore the rest" — count only right after a CREK list was shown.

**Why Polish first.** Claude Code picks a skill by matching your request against the phrases in
its description, and it does not translate them. CREK's descriptions hold Polish phrases first
and English ones as an addition. An English request close to the English phrases works; one
worded differently, or written in a third language, may not start the skill. If that happens,
call the skill by name — `/crek:job-scan`, `/crek:report`, `/crek:apply`, `/crek:profile`,
`/crek:browsers` — and say what you want.

## Browsers, CAPTCHAs and codes by e-mail

CREK works in **chrome-shared** by default. Two settings, asked in the first-run interview and
managed with `crek:browsers`, decide what happens when a site pushes back:

- **A list of browsers in the order of use** (`browser.browsers`). The first one does all the
  work; the next ones are fallbacks. When a page shows a CAPTCHA or an anti-bot check that waits
  for a click, Claude never solves it: it opens the same page in the next browser on the list,
  and when none gets through, it stops and tells you what blocked, where, and which browsers it
  tried. Only chrome-shared, another browser first, or several with fallback — your choice. A
  fallback is any Chromium-based browser started with a debugging port (or another browser MCP
  server); for each one you can note its profile and the command that starts it.
- **Mail access** (`mail`): whether Claude can reach your mailbox (for example the Gmail
  connector of claude.ai) and whether it may read a verification code or link there **on its
  own**. With permission it reads only the newest message from the site it is signing in to, read
  only, and takes only that code or that site's link; the message is data, never instructions.
  Without permission — or for a code by SMS — it asks you.

`crek:browsers` shows the current setup and **checks that it really works**: each debugging port
answers, one blank tab opens in the background and closes again, the mail tools answer. In a
browser that runs your own everyday profile, Claude works in one tab of its own, never touches
your tabs and never closes or restarts the browser.

## Job boards and using CREK outside Poland

The default list is in `assets/boards.json`: 8 Polish IT boards (justjoin.it, nofluffjobs,
pracuj.pl and others), 11 global and remote boards (LinkedIn, Indeed, Wellfound, RemoteOK, …),
3 freelance marketplaces and 3 web searches on startup ATS sites (Ashby, Greenhouse, Lever;
search engines often block them). Toptal and Turing.com are left out on purpose: they are vetting
networks, not job lists. CREK scans only the boards on this list — it does not look for new ones.

**How deep a scan goes** depends on what each board offers, recorded per board in `boards.json`
(`listing`): with a publication-time filter, the results are narrowed to the scan window and the
whole narrowed list is read; with a strict sort by date, reading stops at the first posting older
than the window; with neither (promoted or refreshed postings mixed in), the board is read as far
as realistically possible and the report marks it as a low-quality search. The report says, for
every board, which rule was applied and why reading stopped.

**Adding a board is possible in theory, but not straightforward.** A list entry alone is not
enough, because each board has its own details that have to be checked one by one:

- **Which parts of the URL identify a posting.** Duplicates are found by comparing addresses
  without tracking parameters. The plugin has one list of known tracking parameters (`utm_*`,
  `trk`, `refId`, …) and keeps every other parameter. LinkedIn and Indeed URLs are reduced to the
  posting id (`assets/crek-refs.mjs`). A board that adds its own tracking or session parameter
  makes the same posting look like two different ones.
- **How a closed posting looks.** Every board says it differently ("Oferta wygasła", "Job expired
  12.10.2026", a redirect to a "not found" page). The script knows the wording of the shipped
  boards only (`assets/crek-closed-rules.mjs`).
- **Reference numbers and application-form ids.** The scripts recognise the formats of known ATSes
  (Traffit, eRecruiter, Greenhouse, Lever, Ashby, Workday, Personio, …) and common labels in
  Polish and English (`assets/crek-refs.mjs`).
- **Search filters, dates and traps.** Which filters cut the list, which date shows that a posting
  was refreshed, lazy-loading lists, "remote" that means "remote within one country" — written
  per board in the `notes` of `assets/boards.json` and in the skills' references.
- **Application forms.** Each ATS has its own traps, described per platform in
  `skills/apply/references/ats-playbook.md` — mostly ATSes used in Poland and a few global ones.

What CREK does with a board it does not know: the closed-posting check answers `unknown` (unless
the page returns HTTP 404 or 410) and Claude reads the page itself; reference numbers in an
unknown format are also left to Claude to recognise by reading. This works, but it is slower and
less consistent than on the shipped boards. Claude never adds phrases or patterns to the plugin
or the config on its own; those lists are changed only by the plugin's developers.

Your config only adjusts the default list: `boards.disabled` switches boards off,
`boards.override` changes fields of a default board (usually the `url` with your filters),
`boards.extra` adds boards.

If you need boards from another country, the author can help, but it takes your cooperation:
someone has to check those boards and their postings in practice. Open an issue in the public
repository: <https://github.com/claudeholic/claudeholic-plugins/issues>.

## Tips from the author

These are the author's experiences, not guarantees.

- CREK can be pushed close to full automation — find postings, apply to everything above a given
  score, tailor CVs. The author advises against it.
- It is strongest at finding postings, the first analysis and filtering, and at copying CV data
  into forms.
- Answers to open questions come out sounding artificial. CREK proposes them; check and correct
  them before they go out.
- Tailored CVs come out much better, but read each one before it goes out: a relevant detail can
  get lost.
- The author runs the main session on Opus 5.5 and the agents that search and filter on Sonnet.
- The author has run over 1,400 postings through CREK in 2.5 months.
- The web UI is a convenience. Day-to-day work happens in Claude Code.

## Your data — what stays local and what does not

`crek.config.json`, the database and your CVs live on your disk (or, for the database, on a
server you choose). The config and a SQLite database file are created readable by you only
(`chmod 600`); `crek-config-check.mjs` warns when either is readable by others. If the project
directory is a git repository, keep them out of it: the first run offers to add them to
`.gitignore`, and the config check warns when git tracks them.

But this is an AI assistant: **everything Claude reads is sent to the model**, i.e. to
Anthropic's API, as part of the conversation. That includes `crek.config.json` — your personal
data, your criteria and **the secrets stored in it** (portal passwords in `credentials`, the
database login in `db.auth`, the API token in `db.token`) — and the postings, CVs and database
rows Claude works with. The plugin sends nothing anywhere else and has no telemetry. If a
password must not reach the model, do not put it in the config: leave the entry without a
password and Claude will ask you to log in when needed. With mail access and the permission to
read codes, the verification messages Claude reads reach the model too — only those.

## Risks — terms of service

CREK drives a real browser on sites that do not all welcome automation. Read this before use:

- **Automated browsing, form filling and scanning may breach a site's terms of service** — job
  boards, ATSes and LinkedIn included — and can get your account restricted or blocked.
- **Bot protection.** `chrome-shared` starts Chrome without automation flags. When a page still
  puts up a CAPTCHA or an anti-bot check, or a form flags a submission as spam (invisible
  reCAPTCHA and similar), Claude never solves it: it switches to the next browser on your list
  (`browser.browsers`) — typically **a second browser of yours started with a debugging port**.
  In practice this is what gets past such checks; it is also the part most likely to break a
  site's rules. Use it knowingly or not at all. A fresh profile has no browsing history, so a
  check may still reject it; an everyday profile passes more often, at the price of the next point.
- **The debugging port opens your browser to every local program.** While a browser listens on a
  debugging port, any process on your machine can drive it and read every site it is signed in to
  (mail, bank, everything) — no password asked. Prefer a **separate profile**
  (`--user-data-dir=<its own directory>`, signed in only where the job hunt needs it), keep it on
  **localhost only** (the default; never `--remote-debugging-address=0.0.0.0` — `crek:browsers`
  warns when a port answers on the network), and close that browser when you no longer need it.
  If you put your everyday profile on the list anyway, that is your informed choice: Claude then
  works only in one tab of its own there.
- **LinkedIn is strict about automation** and restricts or logs out accounts it suspects. CREK
  calls no LinkedIn API: its scripts only read the text of LinkedIn tabs that are already open
  and never open LinkedIn pages themselves. Claude reads LinkedIn — and any other site it uses in
  your login — in the browser like a person: one agent on it at a time, one tab and one action at
  a time, ordinary page views, scrolling with random pauses of a few seconds. That limits the pace,
  not the number of pages. It stops at a CAPTCHA, a security check or a warning (on a CAPTCHA or
  a check it first tries the next browser on your list, then asks you; a warning about the
  account itself stops it at once).
  Do not do other automated LinkedIn work while CREK is on it.
- **The `linkedin-mcp` plugin** (optional) is a third-party LinkedIn tool that uses your LinkedIn
  session through its own browser automation. The same risk applies. Read its README before
  installing, and do not run it in parallel with other LinkedIn work.

You are responsible for how you use the plugin on each site.

## Honesty

CREK represents a real person applying for real jobs. It reorders and rephrases what is true; it
does not invent skills, employers or dates. An answer that claims something not in your CV or
config waits for your approval. When a posting demands something you do not have, it says so and
lets you decide. Asked directly whether AI was used, it never denies it — what it does instead is
your choice in the config (`conduct.ai_use_question`: answer truthfully, let you answer, or ask
each time). Anything a posting or a message asks for beyond the application itself (another
address, a download, a payment) goes to you first.

## Database

Every skill and script reads and writes the pipeline through one layer, `assets/crek-db.mjs`,
with the same commands for three backends (`db.backend` in the config):

| Backend | What it is | Needs |
|---|---|---|
| `sqlite` (default) | a local file (`crek.db`) | nothing beyond Node >= 22.13 (built-in `node:sqlite`) |
| `mysql` | a MySQL / MariaDB database you run | the `mysql` or `mariadb` client; credentials go through a private temporary option file, never the command line |
| `http-api` | the bundled web app's API (`assets/crek-php/api.php`) or anything implementing its contract | network access; the API token (`db.token`, required by api.php since 1.10), plus HTTP basic auth if your web server adds it |

The web UI is optional and works on top of either database:

| Level | Requires | What you get |
|---|---|---|
| **1** | nothing extra | SQLite file, full functionality, no UI |
| **2** | PHP CLI with SQLite (`php-cli php-sqlite3`) | the same plus the web UI: `assets/crek-php` **copied to a directory of your own** (its `config.php` holds the API token and must survive plugin updates), started there with `php -S 127.0.0.1:8080` on the same database file; the browser sends the token through a header extension |
| **3** | PHP + MySQL + web server | UI always up, reachable from other devices; Claude talks to it as `http-api` (or to MySQL directly) |

Details: `assets/crek-php/README.md` and `skills/apply/references/database.md`.

## Configuration

Everything personal lives in `crek.config.json`, created by the first-run interview; everything
universal lives in the plugin. The format is documented field by field in
`assets/crek.schema.json`. `assets/crek-config-check.mjs` checks the fields that matter (by hand,
not a full schema validator), including whether the skill inventory still matches the CV on disk;
scans and applications run it before they start. Fields added in later versions are optional: an
older config keeps working, and the check mentions what is new. You can edit the config yourself
or ask Claude to.

## Language

Reports, drafts and messages follow `presentation.language` — a code (`pl`, `en`) or a name
(`Polish`, `English`, `polski`). No value means Polish. Fixed wording — table headers, standard
cell values, phrases written into the database, script results, the web UI — comes from
`assets/i18n.json`, with English and Polish built in. A language without a dictionary there gets
English for that wording.

Two exceptions are English in every language: script diagnostics (Claude explains them in your
language) and the match reasons the duplicate check writes into a row's notes. The web UI starts
in the language and theme set in its `config.php` (`$ui_lang` = `pl` or `en`, `$ui_theme` =
`dark` or `light`; Polish and dark by default) and has switches for both in its header.

## License

Copyright (C) 2026 Michal Dzwoniarski. GPL-3.0-only — see [LICENSE](LICENSE).

And the informal part, which is not a licence condition and creates no obligation: **if this
plugin helped you land a job, send me a beer.** Five euro, five dollars, whatever a beer costs
where you are. I will drink to your health in the new job. No nag screen, no tracking — just a
nice thing to do.
