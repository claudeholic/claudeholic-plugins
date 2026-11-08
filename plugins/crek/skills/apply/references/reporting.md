# Reporting results

The user reads these reports several times a week and compares them against each other. A layout
that changes between runs forces them to re-read the format instead of the content, so the shape
below is fixed. Language follows `presentation.language`; extra wording rules come from
`presentation.rules`.

## Language

Fixed wording — column headers, the standard cell values below, section headings, CREK
`communication` phrases, the phrases written into `notes`, script output — is never improvised: it comes from
`${CLAUDE_PLUGIN_ROOT}/assets/i18n.json`, a dictionary `{"en": {...}, "pl": {...}}` with stable keys
(`report.col.*`, `report.value.*`, `report.section.*`, `comm.*`, `note.*`, `match.*`, `ui.*`). Templates
carry `{placeholders}`, filled in literally (`report.value.batch_count` → EN `10 of 62` /
PL `10 z 62`).

**Resolving the language** (this is the one place the rule is defined; scripts implement the same):

1. Take `presentation.language`, trimmed, case-insensitive.
2. A code that is a key of i18n.json (`en`, `pl`) is used as is; a code with a region (`en-GB`,
   `pl_PL`) uses its base code.
3. A name is matched against each dictionary's `language_names` — `English`/`angielski` → `en`,
   `Polish`/`polski` → `pl`.
4. No value at all → `pl`, the plugin's default (it is made for the Polish job market).
5. Anything else → `en`: a user who asked for a language CREK has no dictionary for is better
   served by English than by Polish.

The resolved code decides only the fixed wording. Free text Claude writes (the verdict, drafts,
explanations) follows `presentation.language` as written. To add a language, add a dictionary
with every key of `en` and its `language_names`.

## The table

Every posting list — a scan, a single analysis, a "what is still open" summary — uses these columns
in this order, headers taken from `report.col.*` in the resolved language:

| Key | `tab` | `posting` | `rate` | `match` | `pros` | `cons` | `comments` |
|---|---|---|---|---|---|---|---|
| EN | Tab | Posting | Rate | Match | Pros | Cons | Comments |
| PL | Tab | Oferta | Stawka | Dopasow. | Plusy | Minusy | Komentarze |

So the header row the user sees is either

| Tab | Posting | Rate | Match | Pros | Cons | Comments |
|---|---|---|---|---|---|---|

or

| Tab | Oferta | Stawka | Dopasow. | Plusy | Minusy | Komentarze |
|---|---|---|---|---|---|---|

The columns mean the same in every language. Below they are named by their English header.

- **Tab** — the number the user sees in the tab strip, `—` when the posting is not open. With the
  chrome-shared plugin that is the `[N]` prefix its extension adds to every tab title (a tab titled
  `[21] Praca GenAI Engineer…` is `21`; in `list_pages` output `8: [21] …` it is `21`). It is **not**
  the MCP `pageId` (the leading `8:`) and **not** the tab's position in the window — the user can see
  neither, and both change. See chrome-shared's skill, section *Tabs numbered for the user*. Re-run
  `list_pages` right before printing the table: numbers are only valid for tabs that still exist.
  Tabs in the batch window (an `isolatedContext`) get no prefix: there the Tab is the tab's
  position in that window, and a shared-context tab in the same table is written as in its title,
  `[395]` (*The batch window* below). If the browser adds no prefix (e.g. Brave over raw CDP),
  give the page title instead of a number.
- **Posting** (`report.col.posting`) — `Company — Title`. Agency and end client both, when known: `Acme Talent — DevOps / SRE
  (Globex)`. Never reproduce gender-suffix legalese from the title.
- **Rate** (`report.col.rate`) — as posted, in the posted unit, with the unit suffix from
  `report.unit.*`: `174–209/h`, EN `20–27k/mo` / PL `20–27k/mies`, and when there is no rate
  `report.value.not_disclosed` (EN `not disclosed` / PL `nie podano`). Do not convert silently; if
  a comparison needs converting, say so in the verdict.
- **Match** (`report.col.match`) — the 1–10 score from `scoring.md`, already lowered by any failed blocker. Nothing
  else goes in this column. Only a posting closed to the candidate's country gets `—` here.
- **Pros** (`report.col.pros`) — covered mandatory requirements, named. Two to four, comma-separated.
- **Cons** (`report.col.cons`) — uncovered mandatory requirements and partials with their reason.
  Same length. An empty cell means nothing is missing — rare, and worth a second look before
  printing it. Blockers belong here too, worded by the standard values:
  `report.value.core_tech_blocker` (EN `Azure as the core of the role` / PL `Azure jako rdzeń
  roli`), `report.value.employment_only` (EN `employment contract only` / PL `tylko UoP`). A
  blocker is just the strongest minus — it does not need a separate section.
- **Comments** (`report.col.comments`) — the user's prior decisions and opinions
  (`report.value.accepted`: EN `accepted` / PL `zaakceptowane`; `report.value.revisit_later`:
  EN `revisit later 17.09` / PL `przemyślę później 17.09`), Claude's short suggestion
  (`report.value.suggest_apply` / `suggest_skip`: EN `apply`, `skip` / PL `aplikuj`, `odpuść`), or
  both. A ruling the user worded themselves is quoted as they wrote it, in their language. This
  column carries memory across sessions: when the user already ruled on a posting, that ruling
  appears here, not in the verdict. When the user has not spoken, Claude's suggestion goes here
  instead. Suspected repeats and reposts use their templates too:
  `report.value.likely_same_posting` for a `!` hit from `crek-match.mjs` — same agency, same
  normalised title, overlapping rate (EN `likely the same posting as #503 Tailspin, applied 16.10` /
  PL `najpewniej to samo ogłoszenie co #503 Tailspin, applied 16.10`) — in the table only when that
  entry is `new`, `skipped` or `declined`: a likely repeat of something applied to is not a row
  at all (*Repeats of applied postings*);
  `report.value.possibly_same_client` (EN `possibly the same client as #71 Litware, applied 12.09, no
  response` / PL `możliwie ten sam klient co #71 Litware, applied 12.09, bez odpowiedzi`) and
  `report.value.repost_first_published` (EN `repost — first published 24.09` / PL `repost —
  pierwotnie 24.09`). A posting that closed is not a row at all (*Closed postings*); in a list
  of sent applications a closed one carries `report.value.closed` here. A posting met again
  after it was set aside unreviewed (`skipped`) uses
  `report.value.previously_skipped` (EN `previously skipped without review (#123, 30.10)` / PL
  `wcześniej pominięte bez przeglądu (#123, 30.10)`) — never "declined", never "already in the
  pipeline", and the earlier skip is no reason to suggest skip: score and suggest as for a new
  posting.

Sort by score, highest first. Ties break by rate — compare rates converted to PLN/h, or to the
currency of `criteria.blockers.min_rate` when that is not PLN (monthly ÷ 168,
annual ÷ 12 ÷ 168, day ÷ 8, foreign currency at the current rate), but print them as posted.
Postings without a rate go after those with one at the same score. Unscored postings (`—`) go last.

## Batches of ten

A scan or a pool of open postings is shown **ten at a time** by default, not as one long table.
The user decides on each batch, and a table of eighty rows gets skimmed rather than read. If the
user asks for a different size (EN "show 5", "next 20" / PL "pokaż 5", "kolejne 20"), use that
size for this batch.

- The first batch is the top of the whole sorted list. Say how many postings there are in total
  (`report.value.batch_count`: EN `10 of 62` / PL `10 z 62`), so the user knows how much is left.
- Every posting in a batch is open in the browser and its tab number is in the Tab column — that
  is what the Tab column is for. A batch printed with `—` in every Tab cell is a broken batch.
- **When a batch may be replaced — both conditions, never just one:**
  1. the user has **verified the current batch** and you have their confirmation of it — a ruling on
     its postings or an explicit close (see *User commands* below),
  2. **and** the user asks for the next one.
  A batch the user has not ruled on stays open, untouched. A finished scan, an agent's report or a
  new list you happen to have ready is **not** a request for it: say in one line that it is ready
  (how many postings, the best one) and wait. One message carries at most one batch table.
- **Switching to the next batch, once both conditions hold, in this order:** first close every tab
  of the previous batch **and every other tab left in that window by this session or its agents**
  (postings opened on request, research pages, finished forms, CV previews) — only tabs the user
  opened themselves stay; then open the new batch's tabs **in the batch window** the previous batch
  used (*The batch window* below; if that window is gone, open a new one and keep using it for later batches). Then list the window's tabs: it must contain exactly the new batch (plus the user's own tabs);
  close any leftover before printing. Never report "closed the previous batch" without this check.
  Then re-read the tab numbers and print the table. Never leave the old batch open next to the new one, and never
  spread one batch over other windows (the one exception: postings that need the user's login, in their regular window — *The batch window*) — the user must see exactly the postings in the table, in
  one place. Keep the old tabs only if the user explicitly asks to.
- **"Next 10" / "kolejne 10" means the next ten by the same sort order — nothing else.** Do not filter by track,
  topic or anything said earlier in the conversation, and do not reshuffle the list between batches.
  Rows the user has already decided on (applied, declined), rows set aside unreviewed
  (`skipped`) and postings closed by the employer (`closed`) drop out; everything else keeps its
  place.
- Show a batch only after the postings in it have been checked and scored. Opening unscored postings
  wastes the user's time.
- Show a batch only after its tabs have been checked for closed postings (next section) and for
  repeats of applied postings (the section after it).

## The batch window

The batch the user looks at opens in **one window of CREK's own**, never among the user's tabs in
another window. This applies to every batch — the first one of a scan, "next 10", a re-shown
table, "open the first 10", postings opened on request.

- **Which window.** Right after a scan, in the same session: the scan's window — its
  `isolatedContext` (`crek-scan-…`) and its anchor tab (*One browser window per scan* in the
  job-scan skill), which the scan leaves open for this. Otherwise — a report with no scan in this
  session, or the scan's window gone — open one the same way: an anchor tab with `new_page`,
  `url: "file://${CLAUDE_PLUGIN_ROOT}/assets/crek-anchor.html"` and `isolatedContext` named
  `crek-report-YYYYMMDD-HHMM`; note the name and the anchor's `pageId` and use that window for
  every later batch. Never reuse a context name this session did not open. Each posting:
  `new_page` with the window's `isolatedContext` and `background: true`, in table order.
- **Postings that need the user's login to show** — LinkedIn, Indeed and other boards whose page
  is logged out or behind a login wall without the user's session (an isolated context has no
  cookies) — are the exception: they open in the shared context (no `isolatedContext`), in the
  user's regular window, as before — one after another, each loaded and read before the next,
  with pauses (*Boards you are signed in to* in `ats-playbook.md`). Everything else goes into the batch window; a batch without
  such postings is one window.
- **Tab numbers.** chrome-shared numbers (`[N]` in the title) only the tabs of the shared
  profile; tabs in an isolated context have no number. A batch-window tab is therefore given by
  its **position**: the anchor is the first tab, the first posting after it is `1`, the next `2`,
  counted in the order you opened the tabs that are still open (a new tab goes to the end of the
  window; when you close one, the tabs after it move up by one). A shared-context tab keeps its
  number, written as in its title: `[395]`. Count the positions once the batch's tabs are final,
  right before printing, and say in one line above the table what the numbers mean, EN `Tabs 1–8:
  the CREK window, counted from the anchor; [N]: your main window` / PL `Karty 1–8: okno CREK,
  liczone od kotwicy; [N]: Twoje główne okno`. The user's answer ("3 send", "[395] decline") is
  read against the printed table, never by counting the tabs again; a bare number that could be a
  position and an `[N]` both → ask which.
- **Checks.** `crek-closed-check.mjs --tabs` and `crek-dedupe-check.mjs --tabs` find tabs by the
  `[N]` prefix, so they do not see batch-window tabs. For those rows, run the closed check with
  `--urls` on their rows (it opens one tab of its own and closes it; LinkedIn URLs stay
  `unknown`) and the repeats check with `--ids <row ids> --open-earlier` (stored refs), both before
  opening the tabs; then, as you make each tab readable, read what it says — a posting closed in
  any wording is closed (*Closed postings*). Shared-context rows are checked with `--tabs` as
  below.
- **When the window closes.** The anchor stays open while batches are being shown. Close the
  batch window's tabs and then its anchor when the review is over — the user has ruled on the last
  batch, set the rest aside ("skip the rest"), or asks to close it. If the user closes the window
  themselves, nothing breaks: the next batch opens a new anchor. A new scan opens its own window
  and does not close an earlier batch window; that one closes by this rule.

## Closed postings

A posting open at scan time can close before the user looks at it — LinkedIn postings close
within hours, and the page then says "No longer accepting applications" (PL "Kandydaci nie są
już akceptowani"). A closed posting in a batch wastes the user's time and reads as a broken
scan, so **right before printing any batch** — the first batch of a scan, "next 10", a re-shown
table, postings opened on request — after the tabs are open and their numbers re-read, check
every tab of the batch (batch-window tabs, which have no `[N]`: *Checks* in *The batch window*):

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-closed-check.mjs" --tabs <every Tab number of the batch> --config crek.config.json
```

It only reads the tabs (their page text — no site API, LinkedIn included) and prints one
verdict per tab: `closed` with its evidence, `open`, or `unknown` (see *Closed postings* in the
job-scan skill). A LinkedIn tab is never `open`: without the closed phrase it is `unknown`. Then:

- **`closed`, row still `new` (or `skipped`)** → it is **not shown as a row**. Close its tab and
  fill its place with the next posting in sort order (open it, check it the same way), so the
  batch still holds open postings only. Under the table, in the section `report.section.closed`
  (EN *Closed by the employer — taken out of the batch* / PL *Zamknięte przez pracodawcę —
  wyjęte z partii*), list each one on a line: `#1188 Adatum — SysOps Engineer:` followed by
  `report.value.closed` (EN `closed — no longer accepting applications (checked 30.10 14:20)` /
  PL `zamknięte — nie przyjmuje już zgłoszeń (sprawdzone 30.10 14:20)`; `{checked}` is the
  `checked_at` of the check, as `DD.MM HH:MM`). Omit the section when nothing closed.
- **Record it in the pipeline** right away: `status=closed`, and append to `notes` the date,
  `note.closed` from i18n.json and the evidence (EN `30.10.2026: closed — no longer accepting
  applications (checked 30.10 14:20); "No longer accepting applications"` / PL `30.10.2026:
  zamknięte — nie przyjmuje już zgłoszeń (sprawdzone 30.10 14:20); …`), with `crek-db.mjs jobs:update`
  and `jobs:append` (`database.md` in this directory).
  `closed` is the employer's stop, so it is neither `declined` (the candidate's no) nor
  `rejected` (the employer's no to the candidate) nor `skipped`: it never counts against the
  company, and it keeps the posting out of "next 10" and "what is open" so it does not come back.
  A later scan that finds the same URL active again brings the row back to `new` (job-scan,
  step 6).
- **`closed`, row already `applied` or later** → the status stays (the application exists); in a
  list of sent applications put `report.value.closed` in Comments.
- **`unknown`** → look at the tab yourself (snapshot or screenshot) before printing and judge
  what the page says; if it is closed in any wording, handle it as above. For LinkedIn, the
  `linkedin-mcp` tools may answer instead when they are installed (*LinkedIn* in the job-scan
  skill); never a script or an API call of your own.
- **`open`** on a board judged by its phrases alone (the reason says *fast path*) → the script
  only knows some wordings: skim the tab's text, and if it says the posting no longer takes
  applications in other words, it is closed. Never add the wording to `boards.json`, the
  script or the config — it is recognised by reading.
- **No browser to check with** → say so in one line above the table; never skip silently.

A batch printed without this check, or with a closed posting as a normal row, is a broken batch,
like one printed with `—` in every Tab cell.

## Repeats of applied postings

The same recruitment comes back through another board: #1204 Northwind on LinkedIn is #812
Northwind from pracuj.pl (same `JOB-7K2QX`, applied 22.10); #1131 Fabrikam on theprotocol is #874
from justjoin; #956 Tailspin is #503 (same Traffit form 48213). Printed as ordinary rows with a hint
in Comments, such repeats make the user rule on — and ask to send — applications already sent. So **right before printing any batch**, together with the closed check, every row that has
a `!` likely-same hit (or a possibly-same-client suspicion) on an entry with status `applied`,
`interview`, `offer`, `declined` or `duplicate` (followed through `duplicate_of_id` to the entry
holding the decision) is resolved first (batch-window tabs: *Checks* in *The batch window*):

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-dedupe-check.mjs" --tabs <every Tab number of the batch> --config crek.config.json --open-earlier
```

It reads each tab (page text — on LinkedIn the posting's own panel — and the links behind "Apply" /
"Aplikuj"; no site API), maps the tab to its pipeline
row by URL (`--tabs 306=1169` names it), extracts reference numbers and ATS form ids
(`assets/crek-refs.mjs`, see *Reference numbers* in the job-scan skill), runs `crek-match.mjs` and
prints one verdict per tab with the note to record. `--open-earlier` opens the earlier entry's
page in one tab of its own when that entry stores no refs, and closes it — except a LinkedIn
page, which it never opens (a warning names the entry: compare its refs yourself, through
`linkedin-mcp` or the page in the browser). LinkedIn's external Apply is a button without a link,
so for a LinkedIn tab the apply target is not read; when it matters (a `!` hit on an applied
entry), click Apply, read the employer's URL and pass it to `crek-match.mjs` as `apply_url`.
Read only. Without a browser, `--ids <row ids>` decides from stored data. Problems (no such row,
no tab, what could not be read) are printed after `!` / in `warning` — never part of the note
to record. Then:

- **`duplicate`** — a reference number, an ATS form / job id or the URL is shared with an earlier
  entry (the same form id in apply targets counts as equal). **Not a row.** Record
  `status=duplicate, duplicate_of_id=<earlier>` and append to `notes` the dated note the script
  prints with its evidence (EN `30.10.2026: hard duplicate of #812 Northwind (applied 22.10) —
  shared: JOB-7K2QX, greenhouse:7712345 (checked 30.10 20:52)` / PL `30.10.2026: twardy duplikat
  #812 Northwind (applied 22.10) — wspólne: …`), close its tab and fill its place with the next
  posting in sort order, checked the same way. List it under the table in *Already in the
  pipeline* with `report.value.same_posting`.
- **`in_pipeline`** — not provably equal, but the same company/agency and the same normalised
  title as an entry applied to (`applied`, `interview`, `offer`). **Not a row either**: the
  status stays, close its tab, fill its place, and list it under the table in *Already in the
  pipeline* (`report.section.in_pipeline`) with id, status and date, worded with
  `report.value.likely_same_posting` (PL `#1131 Fabrikam — najpewniej to samo ogłoszenie co #874
  Fabrikam, applied 27.10`). Append the printed note to its `notes` so the next batch skips it too.
- **`keep`** — everything else: a `!` hit on a `new`, `skipped` or `declined` entry stays in the
  table as today, with its template comment in Comments (`report.value.likely_same_posting`,
  `report.value.previously_skipped`).
- **`unknown`** (no tab, an error) → check the posting yourself before printing.

Never put a posting in front of the user for a decision when an entry for it was already applied
to without saying so first — in the table that means it is not there, it is in *Already in the
pipeline*. A posting the user explicitly asks about anyway is answered with that entry first.

## User commands

Typical wording, side by side. These are examples, not a vocabulary: the user's own wording in any
language counts — recognise the intent, whatever language the user writes in and whatever
`presentation.language` says.

| Intent | EN | PL |
|---|---|---|
| next batch, same order | "next 10", "next" | "kolejne 10", "następne" |
| another batch size | "show 5", "next 20" | "pokaż 5", "kolejne 20" |
| ruling on a batch | "send 395, decline the rest" | "395 wyślij, reszta odrzuć" |
| set the rest aside unreviewed (`skipped`, no decision) | "skip the rest", "ignore the rest" | "pomiń resztę", "zignoruj resztę", "nie przeglądamy reszty" |
| nothing from this batch | "none of these" | "z tego nic" |
| close the batch | "close" | "zamknij" |
| show a finished scan | "show the scan results" | "pokaż wyniki skanu" |

**Skip is not decline.** "Decline the rest" sets `status=declined` — the candidate's no to those
postings. "Skip the rest" sets `status=skipped` for the rest of that list (not only the shown
batch), with the date and `note.skipped` (EN `skipped without review` / PL `pominięte bez
przeglądu`) appended to `notes` — the candidate did not look at them, so nothing was decided. Skipped rows leave "next 10" and "what is open" like
decided ones, but a later scan that meets the same posting brings it back as new (job-scan skill,
step 6). Ambiguous wording → ask which one.

## Below the table

Section headings come from `report.section.*` (EN *Already in the pipeline*, *Verdict*,
*Boards scanned*, *Dropped at title level* / PL *Już w pipeline*, *Werdykt*, *Przeszukane
portale*, *Odrzucone po tytule*).

**Closed by the employer — taken out of the batch** (`report.section.closed`) — directly under
the table, only when the closed check took something out (see *Closed postings*): one line per
posting, `#id Company — Title: report.value.closed`. At scan time a closed posting goes into
*Dropped at title level* instead, with the same value as its reason.

**Boards scanned** — one line per board used: its name, then the stop rule applied and why the
reading stopped (*How far to go on each board* in the job-scan skill), worded with
`report.value.stop_time_filter`, `report.value.stop_relevance_drop`, `report.value.stop_date_order`,
`report.value.stop_order_broken`, `report.value.stop_limit` or `report.value.low_quality_search`
(EN `justjoin.it — time filter 7 days: the whole filtered list read (64 postings)`; PL
`Himalayas — niska jakość wyszukiwania (sortowanie nie ściśle po dacie, brak filtra czasu):
przeczytane 120 ofert, tyle, ile realnie się dało`); a board stopped by a block says so instead,
with the browsers tried. Then, on its own line under
`report.section.boards_disabled` (EN *Skipped — disabled in config* / PL *Pominięte — wyłączone
w configu*), the boards in `boards.disabled`. Omit that line when nothing is disabled.

**Already in the pipeline** — hard duplicates (the same URL, reference number or application-form
id), with id, status and date: EN `#37 Acme Talent DevOps/SRE — interview 18.09, the same posting` / PL
`… — interview 18.09, to samo ogłoszenie` (`report.value.same_posting`); and likely repeats of an
entry applied to (`in_pipeline` from *Repeats of applied postings*), worded with
`report.value.likely_same_posting` (PL `#1131 Fabrikam — najpewniej to samo ogłoszenie co #874 Fabrikam,
applied 27.10`). A `skipped` entry is never listed here: it goes back into the table as a new
posting with `report.value.previously_skipped`. A likely-same posting of a `new` / `skipped` /
`declined` entry, or a suspected repeat through another agency whose refs differ or are unknown
and whose earlier entry was not applied to, stays in the table, with the earlier entry in
Comments.

**Verdict** — two or three sentences, not a paragraph per posting. What to attack first and why,
what needs a decision from the user, what has a deadline.

## What not to do

Do not pad the table with columns the user did not ask for. Do not replace a missing value with a
guess — `not disclosed` / `nie podano` is information, an invented range is not. Do not hide a
posting that fails a blocker or give it a section of its own: as `scoring.md` says, it is a row
like any other, with the failed blocker first in Cons and the lower score it costs — the user
decides whether the blocker really ends it.
