# The pipeline database — how to read and write it

Every read and every write goes through one script, whatever holds the pipeline:

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-db.mjs" --config crek.config.json <command> [args]
```

`db.backend` in `crek.config.json` picks the implementation; the commands, the JSON they take and
the rows they return are the same for all three:

| Backend | `db.path_or_url` | What the script uses | Needs |
|---|---|---|---|
| `sqlite` (default) | a file, relative to the config: `crek.db` | Node's built-in `node:sqlite` | Node >= 22.13 |
| `mysql` | `mysql://user@host:3306/database` (`?ssl=required`, `?socket=/path` optional); password in `db.auth` as `user:password` | the system client `mariadb` / `mysql` (or `db.client`); credentials in a private temporary option file | the MySQL / MariaDB command-line client |
| `http-api` | the URL of `api.php` (`assets/crek-php`, or anything implementing schema.sql §API) | HTTP; the API token from `db.token` in the `X-Crek-Token` header (required by api.php from crek 1.10), plus basic auth from `db.auth` when the web server adds it | network access to it |

Do not talk to the database any other way — no hand-written `curl` to the API, no `sqlite3`, no
`mysql` session: the script applies the same rules on every backend (which fields exist, empty
strings, contact links, known statuses, whole numbers for scores, rates and ids, `YYYY-MM-DD`
dates), and a hand-made request is where a backend difference or an escaping bug
slips in. If something cannot be done with the commands below, say so to the user rather than
improvising SQL.

## Commands

| Command | What it does |
|---|---|
| `info` | backend, location, row counts — a connectivity check |
| `init` | creates the tables (`sqlite`: also the file) from `schema.sqlite.sql` / `schema.sql`; safe to repeat. Not for `http-api` (the server owns its tables) |
| `jobs:list [--status S] [--search TEXT] [--since YYYY-MM-DD] [--fields a,b] [--limit N]` | rows, newest `found_at` first. `--search` looks in title, companies, technologies, description, notes and both URLs; `--fields` takes column names (an unknown one is an error) |
| `jobs:get ID` | one row, with `contact_ids` / `contact_names` |
| `jobs:add JSON` | a new row; prints `{"id": N}`. Empty strings are skipped; `technologies` may be a JSON array |
| `jobs:update ID JSON` | changes only the fields given; `""` sets NULL — except `status`, which always needs a value (`""` or `null` there is an error); `contact_ids` replaces the job's contact links |
| `jobs:append ID FIELD [--] TEXT` | adds `TEXT` as a new last line of `notes`, `communication`, `meetings` or `description` — the append-only logs — in one database statement, so parallel appends (several agents) all keep their line. Put the date at the start of `TEXT` yourself, as `DD.MM.YYYY: `. Write `--` before a `TEXT` that may start with `-` (everything after `--` is the text) |
| `jobs:delete ID` | removes a row (rarely right: a wrong posting is `declined` or `duplicate`, not deleted) |
| `jobs:latest [--source A,B]` | the newest `found_at`, optionally among these sources — the start of job-scan's time window |
| `contacts:list` | contacts with `job_count` |
| `contacts:upsert JSON` | inserts, or updates the contact with the same `name` + `company_name`; fields not given keep their value; prints `{"id": N}` |
| `contacts:update ID JSON` | changes only the fields given |
| `contacts:link JOB_ID CONTACT_ID[,…]` | adds links, keeps the existing ones |
| `contacts:delete ID`, `stats` | as named |

JSON comes from the argument, or from stdin with `-` or no argument — use stdin (a quoted heredoc)
for anything with quotes, newlines or text copied from a posting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-db.mjs" --config crek.config.json jobs:add - <<'JSON'
{"title": "Platform Engineer", "agency": "Initech", "source": "justjoin.it",
 "source_url": "https://justjoin.it/job-offer/...", "status": "new", "match_score": 7,
 "technologies": ["Kubernetes", "Terraform"],
 "description": "…analysis…\nREF: JOB-7K2QX; traffit:48213"}
JSON
node "${CLAUDE_PLUGIN_ROOT}/assets/crek-db.mjs" --config crek.config.json jobs:append 1204 notes "30.10.2026: skipped without review"
```

Credentials stay in the config: never pass a password or token on a command line (other users
see it in `ps`). With `--api <url>` instead of a config, the scripts take the token from env
`CREK_TOKEN` and basic auth from env `CREK_AUTH`.

Output is JSON on stdout; an error is one line on stderr starting with `error:` and exit code 1
(2 for a wrong command line), database errors included (`CREK_DEBUG=1` adds the stack trace).
Unknown field names are refused with the list of valid ones, and so is an unknown `status` —
read the list rather than guessing again.

## Fields

`schema.sql` lists the columns and describes the statuses. The allowed `status` values are the
`ui.status.*` keys of `assets/i18n.json` (`new`, `applied`, `interview`, `offer`, `rejected`,
`declined`, `skipped`, `closed`, `duplicate`) — one list for crek-db.mjs, api.php and the web UI;
the stored value is the key, the labels per language sit next to it. Dates are `YYYY-MM-DD`
(`applied_date`, `response_date`); `found_at` and `updated_at` are set by the database. Fixed
phrases that go into `notes` and `communication` come from `assets/i18n.json` (`note.*`, `comm.*`)
in the resolved presentation language — see *Language* in `reporting.md`.

## Other scripts

`crek-match.mjs` and `crek-dedupe-check.mjs` read the pipeline through the same layer
(`--config crek.config.json`), fresh on every run: nothing is cached between runs, so a row written
a minute ago is always seen.
