# Bootstrap — the first run, when there is no `crek.config.json`

Every CREK skill starts by checking for `crek.config.json` in the project directory. When it is
missing, nothing else can work: say so in one line, offer this interview, and create the config
only after the user agrees. Never invent the answers and never continue the original request on
guessed criteria. Ask in the user's language (Polish unless they write otherwise), a few
questions at a time, not all at once.

## The interview

1. **Language** — which language reports, tables, notes and drafts should be in. CREK is made for
   the Polish job market and speaks Polish and English; Polish is the default, English is
   complete (for people working in Poland without Polish). Store a code or a name in
   `presentation.language` (`pl`, `en`, `Polish`); a language without a dictionary in
   `assets/i18n.json` gets English labels (see *Language* in `reporting.md`).
2. **Candidate data**: full name, email, phone, city/country, LinkedIn URL.
3. **Blockers** — the criteria that end a posting outright: contract types accepted (B2B /
   employment / both), minimum rate with unit and currency, work modes, and any narrow exception
   to them (a hybrid role may be acceptable in one city above one rate — ask for the shape of the
   exception, not just "sometimes"), geographic eligibility, technologies that disqualify a role
   when they are its core, working languages refused.
4. **Soft criteria** — technologies to ask about rather than reject (typically ones being learned
   right now), which role families to look for and which only under a condition, and what makes a
   posting a priority regardless of coverage.
5. **Rate policy**: what to quote by default, and where to aim inside a posted range.
6. **CV**: the **master CV** — the one a stranger would receive, ideally the published one — plus
   the directory where per-application variants live, and any standing rules about what may not
   appear on a CV. Then run the `crek:profile` skill to turn that CV into the skill inventory
   scoring depends on; without it, match scores are guesswork.
7. **When a form asks directly whether AI was used** (`conduct.ai_use_question`) — some forms and
   recruiters ask point-blank. Offer the three settings and store the answer:
   - `truthful` — Claude answers yes, truthfully and briefly (an assistant helps prepare and
     submit applications; the experience and the answers are the candidate's);
   - `user_answers` — Claude shows the question and the user writes the answer themselves;
   - `ask` — Claude asks each time what to do.
   Whatever the choice, Claude never denies using AI (see `conduct.md`). If the user does not want
   to decide now, leave the field out: that means `ask`.
8. **Accounts on job portals** (`conduct.account_creation`) — when a form cannot be sent without
   an account and none exists yet, may Claude create one on its own (`auto`), or should it ask
   each time (`ask`)? Not set means `ask`. Password resets of existing accounts are always asked
   about, whatever the answer.
9. **Database backend.** Default to `sqlite` and only go further if the user asks — the web UI is
   a convenience, not a requirement. Whatever the backend, every skill reads and writes it through
   `assets/crek-db.mjs` (see `database.md`).
   - `sqlite` (default, zero setup, Node >= 22.13): `"db": {"backend": "sqlite", "path_or_url":
     "crek.db"}`, then create it with `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-db.mjs" --config
     crek.config.json init`.
   - `mysql`: an existing MySQL / MariaDB database the user controls. Needs the `mysql` or `mariadb`
     command-line client on this machine. `"path_or_url": "mysql://user@host:3306/database"` (add
     `?ssl=required` for a server over the network), `"auth": "user:password"`; then `init`
     creates the tables.
   - `http-api`: the bundled PHP web app (`assets/crek-php/`) or another implementation of the
     contract in `schema.sql` §API: `"path_or_url": "https://host/path/api.php"`, `"token":
     "<API token>"`, and `"auth": "user:password"` only if the web server adds HTTP basic auth
     in front (an extra layer — it never replaces the token). The tables are created on the
     server. **The token:** api.php from crek 1.10 answers nothing without it. Generate one with
     `openssl rand -hex 32` (32 random bytes, 64 hex characters), write it into **both** configs —
     `$api_token` in the server's `config.php` and `db.token` here — and tell the user that
     the browser UI needs the same value sent as an `X-Crek-Token` header by a header extension
     (`assets/crek-php/README.md`, *Access*). Do not print the token back into the conversation
     more than needed. An older api.php without a token keeps working without `db.token`.
   Mention that the bundled UI runs on SQLite too, with no web server to install — but it needs
   **PHP** (the command-line interpreter with SQLite: `php-cli php-sqlite3` on Debian/Ubuntu;
   check with `php -m | grep -i pdo_sqlite`). If the user wants it: **copy**
   `${CLAUDE_PLUGIN_ROOT}/assets/crek-php` into a directory of the user's (e.g. `crek-php/` next
   to `crek.config.json`) — never run it from the plugin's directory, which a plugin update
   replaces together with any `config.php` in it. In the copy: `config.php` from
   `config.php.example` (`chmod 600`), the API token, Option A pointed at the absolute path of
   `crek.db`, optionally `$ui_lang` / `$ui_theme` (the UI also has switches for both); add
   `crek-php/config.php` to the project's `.gitignore` if it is a git repository; start it there
   with `php -S 127.0.0.1:8080`, and set up the header extension in the browser. Offer the
   MySQL + web-server route only to users who want the board reachable from other devices; it
   needs the token (always) and HTTPS, basic auth optionally. See `assets/crek-php/README.md`
   for all three levels.
10. **Tooling**: any house style for user-facing output (`presentation.rules`). Resolve the browser
   binary used as the HTML->PDF fallback with `command -v` and store it — do not assume
   `google-chrome` exists.
11. Write all of it to `crek.config.json` in the format of `assets/crek.schema.json`
    (`version: 2`), `chmod 600` it, keep it out of version control (below), run the config check
    and confirm to the user. Never ask for these again — future sessions read the file.

## Points worth raising because they are easy to get wrong

See `assets/crek.schema.json` for every field, with a note on each explaining what it is for.

- `criteria.blockers.min_rate` fails a posting only when the **top** of its range is below the
  floor. A range straddling the floor is negotiable, and a posting with no rate at all is not
  blocked — it is reported as unverifiable.
- `criteria.blockers.work_mode_exceptions` is where "remote, but one office day a month is fine"
  lives. Write the condition out; a vague exception is applied inconsistently.
- `cv.master` must be the master CV, never a variant tailored to a posting — scoring a posting
  against a CV written for it returns a perfect match and means nothing.
- `presentation.language` — the language you report and write to the user in. Ask explicitly; do
  not infer it from the posting or the candidate's location.
- `browser.pdf_command` — resolve once with `command -v` from `google-chrome`,
  `google-chrome-stable`, `chromium`, `chromium-browser`, `brave-browser` and store the hit.

## What the config holds, and where it goes

Sensitive values — portal passwords in `credentials`, the database login in `db.auth`, the API
token in `db.token` — live only
in this file: never hardcode them anywhere else. Tell the user plainly that Claude reads this file
to do its work, so its content, passwords included, is sent to the model (Anthropic's API) like
the rest of the conversation; if that is not acceptable for a password, leave it out and let
Claude ask for that login when it is needed.

**Out of version control.** If the project directory is a git repository (`git rev-parse
--is-inside-work-tree`), add `crek.config.json`, the SQLite file (`crek.db`, plus `crek.db-wal`
and `crek.db-shm`) and the CV directory to its `.gitignore` — ask before editing a `.gitignore`
the user maintains. `crek-config-check.mjs` warns when git tracks any of them.

## LinkedIn

The `linkedin-mcp` plugin (`/plugin install linkedin-mcp@claudeholic-plugins`) is **recommended,
not required**: it gives Claude LinkedIn tools (search, postings, profiles, messages) through the
user's own session. Without it every LinkedIn step goes through the browser (chrome-shared) and
still works. Mention it once during the bootstrap; do not push.
