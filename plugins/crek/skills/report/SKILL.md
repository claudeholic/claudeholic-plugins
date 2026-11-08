---
name: report
description: "Pokazuje ogłoszenia z bazy zgłoszeń CREK: kolejną partię skanu, otwarte, wysłane, tabelę podsumowującą, oferty otwarte w przeglądarce; zapisuje decyzje użytkownika o partii. Używaj na np. „pokaż tabelę”, „otwórz pierwsze 10”, „otwórz w przeglądarce”, „tabelka podsumowująca”, „co wysłaliśmy”, „pokaż wysłane”, „podsumowanie wysłanych”, „ile wysłaliśmy”, „status zgłoszeń”, „co jest otwarte”, „X wyślij, reszta odrzuć”. Krótkie polecenia („następne”, „kolejne 10”, „pomiń resztę”, „zignoruj resztę”, „nie przeglądamy reszty”) tylko zaraz po wyświetleniu listy lub tabeli ogłoszeń CREK. EN: 'show the table', 'open the first 10', 'summary table', 'what did we send', 'summary of sent', 'what is open', 'send X, decline the rest'; right after a CREK list only: 'next', 'next 10', 'skip the rest', 'ignore the rest'."
---

**Plugin root: `${CLAUDE_PLUGIN_ROOT}`** — commands in `references/*.md` (and in the other CREK skills' references) write `${CLAUDE_PLUGIN_ROOT}`, which is filled in only in this file, not there and not in the Bash tool: always run them with the path above in its place.

# Report — showing postings to the user

Shares configuration and database with the `apply` and `job-scan` skills (`crek.config.json` in the
project root). This skill exists because listing postings is its own activity: it happens between
scans and applications, many times a day, and every time it must look the same.

**Short commands are for CREK lists only.** "next", "next 10", "skip the rest" (PL "następne",
"kolejne 10", "pomiń resztę", "zignoruj resztę") mean this skill only right after a CREK posting
list or table was shown in the conversation. Anywhere else they belong to whatever the user is
doing — leave them alone.

## Before printing anything

0. Check that `crek.config.json` exists. If it does not, there is no pipeline to show: tell the
   user, offer the bootstrap interview (`../apply/references/bootstrap.md`) and stop.
1. Read `../apply/references/reporting.md` **in full, every time** — columns, what goes in each
   column, sort order, batches, what goes below the table. Do not work from memory of an earlier
   read: that is exactly how layouts drift.
2. Read `presentation` from `crek.config.json` — `language` and `rules` apply to every line you
   print, including the table. Resolve the language code as described in *Language* in
   reporting.md and take the column headers and standard values from
   `${CLAUDE_PLUGIN_ROOT}/assets/i18n.json` in that language — never translate them ad hoc.
3. Load the data from the pipeline database, not from conversation memory — through
   `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-db.mjs" --config crek.config.json jobs:list …` (any
   `db.backend`; `../apply/references/database.md`). Scores, statuses and the user's earlier
   rulings (in `notes`) are in the database, and every status change below is written back the
   same way (`jobs:update`, `jobs:append`).

## Which postings

Take the list the user named, literally. The phrases below are examples in EN / PL; the user's own
wording in any language counts (full list: *User commands* in reporting.md).

- **"next N" / "next"** (PL "kolejne N" / "następne") — the next batch of the list currently
  being worked through, by the same sort order (see *Batches of ten* in reporting.md). Not a
  different list, not a filtered one.
- **"what is open"** (PL "co jest otwarte") — `status=new`, sorted as in reporting.md. `skipped`
  rows are not open: the user set them aside; `closed` rows neither: the employer stopped taking
  applications.
- **"what did we send" / "summary of sent"** (PL "co wysłaliśmy" / "pokaż wysłane" /
  "podsumowanie wysłanych" / "ile wysłaliśmy" / "status zgłoszeń") —
  `status=applied` (and later stages) in the period the user names; same table, same columns.
- **No list named and none in progress** — the open postings of the latest scan.

Every list uses the reporting.md table — a summary of applications is still a posting list. Do not
invent a different layout for it.

## Batch size and tabs

Default batch: **10**. The user may ask for another size; use it for that batch.

Every posting in the batch is open in the browser, in the batch window (*The batch window* in
reporting.md), with its tab number in the Tab column:

0. **Only when both conditions in reporting.md hold:** the user has verified the current batch (you
   have their ruling on it, or an explicit "close" / "zamknij") **and** asks for the next. Otherwise leave the
   current batch's tabs alone and, if a new list is ready, only say so in one line.
1. **Close all tabs of the previous batch first** (unless the user asked to keep them) — and every
   other tab this session or its agents left in that window (postings opened on request, research
   pages, finished forms, CV previews). Only the user's own tabs stay. After opening the new batch,
   list the window's tabs and close leftovers before printing.
2. **Then open the new batch in the batch window** the previous batch used — right after a scan,
   the scan's window with its anchor. If there is none (no scan in this session, or the window is
   gone), open one with its own anchor (*The batch window* in reporting.md) and use it for the
   following batches. One batch = one window, plus the user's regular window only for postings
   that need their login (LinkedIn, Indeed and the like — shared context, no `isolatedContext`).
   Those open one after another, never several at once: each loaded, read and made readable
   before the next, with a pause of a few seconds between them, and no other agent on those
   sites meanwhile (*Boards you are signed in to* in `../apply/references/ats-playbook.md`).
   With chrome-shared, open the rest with the batch window's `isolatedContext` and
   `background: true`, in table order;
   with raw CDP, focus a tab of that window before `Target.createTarget` so new tabs land there,
   and verify with `Browser.getWindowForTarget`.
3. Make every page readable: dismiss cookie banners ("reject" / "only necessary" first, then
   close / X, "accept" only when there is nothing else) and overlays, reload once on a Cloudflare
   check (see *Presenting pages to the user* in the job-scan skill). A check that stays — a
   CAPTCHA or an anti-bot page waiting for a click — is never solved or clicked through: open that
   posting in the next browser of `browser.browsers` (one tab of your own, in the background; the
   rules for the user's own profile when the entry has `user_profile: true`), write its Tab cell
   as `<browser name>: <tab title>` and say so in the line above the table; blocked in every
   browser of the list → close the tab, keep the row with `—` in Tab and say under the table what
   blocked it and which browsers were tried (*Codes by e-mail, CAPTCHAs and the browser list* in
   `../apply/references/ats-playbook.md`). A page asking for a code or a link by e-mail follows
   the same section.
4. Re-read the tab numbers right before printing (chrome-shared: the `[N]` title prefix via
   `list_pages`; batch-window tabs: their position, *Tab numbers* in *The batch window*). Tabs
   opened by other agents in between do not belong in the table.
5. **Check every tab of the batch for closed postings, right before printing** —
   `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-closed-check.mjs" --tabs <all [N] Tab numbers> --config
   crek.config.json` (read only); batch-window rows, which have no `[N]`, as in *Checks* in *The
   batch window*. A `closed` posting still `new` is not printed as a row: close
   its tab, record `status=closed` with the dated `note.closed` note and the evidence,
   fill its place with the next posting in sort order (open and check it too), and list the
   closed ones under the table in `report.section.closed`. `unknown` — and `open` judged by the
   script's phrases alone — → read the tab yourself before printing: the phrase list is a fast
   path, a closed posting in other words is still closed (never add phrases anywhere). A
   LinkedIn tab without the closed phrase is always `unknown` (the script reads page text only,
   no LinkedIn API): read it, or ask the `linkedin-mcp` tools when they are installed (*LinkedIn*
   in the job-scan skill). Details: *Closed postings* in reporting.md. Postings close within hours of a
   scan — this check is what keeps a "Kandydaci nie są już akceptowani" page out of the batch.
6. **Resolve repeats of applied postings, alongside step 5** — every row with a `!` likely-same
   hit (or a possibly-same-client suspicion) on an entry `applied` / `interview` / `offer` /
   `declined` / `duplicate`: `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-dedupe-check.mjs" --tabs <all
   [N] Tab numbers> --config crek.config.json --open-earlier`, batch-window rows with `--ids` (read only; compares reference numbers
   in the bodies and where the "Apply" buttons lead). `duplicate` → record `status=duplicate,
   duplicate_of_id=<earlier>` with the dated note and evidence it prints; `in_pipeline` (same
   company + same normalised title as an entry applied to, not provably equal) → status stays,
   append the note; both are taken out of the batch (close the tab, fill the place with the next
   posting, checked the same way) and listed under the table in `report.section.in_pipeline`
   with id, status, date and `report.value.same_posting` / `report.value.likely_same_posting`.
   `keep` rows stay, with the template comment. Details: *Repeats of applied postings* in
   reporting.md. Never ask the user to rule on something already applied to without saying so
   first.

Open only postings that have been checked and scored — an unscored posting is not ready to show.

## After the user rules on a batch

The user usually answers with tab numbers: EN "send 3, decline the rest" / PL "3 wyślij, reszta
odrzuć" — a position in the batch window or an `[N]`, read against the printed table (*Tab numbers*
in *The batch window*).

- Postings to send → the `apply` skill, one application each; report results as they come.
  If a posting was already sent, say so instead of sending it twice.
- "Decline the rest" / "reszta odrzuć" → set `status=declined` for every other posting **of that
  batch only**, appending to `notes` the date and `note.declined` (EN `declined — not interested` /
  PL `odrzucone — kandydat niezainteresowany`). Nothing outside the batch changes.
- "Skip the rest" / "ignore the rest" (PL "pomiń resztę", "zignoruj resztę", "nie przeglądamy
  reszty") → **not** a ruling on those postings: the user is setting them aside unreviewed. Set
  `status=skipped` for every posting of **that list** not yet ruled on (the rest of the current
  scan or list, not only the shown batch — that is what "the rest" means here; if it is unclear
  whether the user means the batch or the whole list, ask), appending to `notes` the date and
  `note.skipped` (EN `skipped without review` / PL `pominięte bez przeglądu`; e.g.
  `30.10.2026: pominięte bez przeglądu`). It counts as the user's verification of the current batch (condition 1 for
  switching). Confirm in one line how many were set aside.
- **Decline vs skip** — "decline" / "odrzuć" is the candidate's no (`declined`); "skip" /
  "pomiń" / "zignoruj" is no review at all (`skipped`). Never record one as the other: a
  `declined` row is presented as already declined when the posting comes back, a `skipped` row
  comes back as new (see the job-scan skill). When the wording is ambiguous ("reszta nie"),
  ask which one.
- Then, **if the user asks** for the next batch, switch batches as described above. A ruling alone
  is not a request for the next batch, and a request without a ruling on the current one is a
  question to ask, not a reason to close its tabs.
- **When the review is over** — the last batch is ruled on, the rest is set aside, or the user asks
  to close — close the batch window's tabs and then its anchor (*When the window closes* in *The
  batch window*, reporting.md).

## Do not

- Do not print a batch with `—` in every Tab cell: that means the tabs were not opened.
- Do not print a batch without the closed check (step 5 above), and never show a closed posting
  as a normal row.
- Do not print a batch without the repeat check (step 6 above), and never show a repeat of an
  application already sent as a normal row.
- Do not mix lists: a request about the current batch is not answered with another list, and a new
  list (a finished scan, a link the user sent) never replaces a batch the user has not ruled on.
- Do not ask which list the user means when the conversation already has one in progress — continue
  it. Ask only when there is genuinely nothing to continue and the request names no list.
