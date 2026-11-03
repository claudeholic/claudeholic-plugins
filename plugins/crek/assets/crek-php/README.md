# CREK — job-pipeline web app (PHP, SQLite or MySQL)

A few files, no framework, no build step. PHP >= 7.4 (tested on 8.3) with `pdo_sqlite` or
`pdo_mysql`; for MySQL, MySQL >= 5.7.22 or MariaDB >= 10.5.

- `api.php` — REST API (contract documented in `skills/apply/references/schema.sql` §API)
- `index.php` — single-file SPA: pipeline board with statuses, search, contacts, stats
- `crek-auth.php` — the access check both of them use (the API token)
- `config.php.example` — copy to `config.php`, set the API token, pick a database connection,
  optionally the UI defaults (`$ui_lang`, `$ui_theme`)

Deploy `api.php`, `index.php`, `crek-auth.php` and your `config.php` together, in one directory —
**your own directory, never the installed plugin's**: a plugin update replaces the plugin's files,
and a `config.php` left there would be gone (with it the token) — see *Level 2*.

## Access — the API token

**Nothing answers without the token** — not the API, not the page. Every request to `api.php`
and `index.php` must carry it in the `X-Crek-Token` header, compared in constant time with
`$api_token` from `config.php`. A missing or wrong token gets a one-line refusal (HTTP 401) after
a short pause (0.2 s) — no data, no application code. With no token configured (or one shorter than
64 characters), both refuse everything (HTTP 503) and say what to set. There is no login form, no
session and no cookie, and the token never goes into a URL or into a page.

1. **Generate it** — 32 random bytes in hex (64 characters):

   ```bash
   openssl rand -hex 32
   # or: php -r 'echo bin2hex(random_bytes(32)), "\n";'
   ```

2. **Put it in `config.php`** on the server: `$api_token = '<the token>';` (keep the file
   readable by the web server only).
3. **Put the same value in `crek.config.json`** for the plugin:
   `"db": {"backend": "http-api", "path_or_url": "https://host/path/api.php", "token": "<the token>"}`.
   The plugin's scripts send it as `X-Crek-Token` on every request.
4. **The browser** gets it from a header extension, e.g. **ModHeader** (Chrome / Firefox / Edge):
   add a *request header* `X-Crek-Token` with the token as its value, and restrict it with a
   **URL filter to this app only** (e.g. `https://crek.example.org/.*`, or
   `http://127.0.0.1:8080/.*` for a local `php -S`) — otherwise the extension sends your token to
   every site you visit. The page's own requests to `api.php` need nothing else: the extension
   adds the header to them too.

Changing the token means changing it in all three places. HTTP basic auth of the web server
(`.htaccess`, `db.auth` in `crek.config.json`) is an **optional extra layer** in front of this; it
never replaces the token. The token travels in a header, so a hosted install needs HTTPS.

**The UI is optional.** The plugin works entirely without it — its scripts and skills read and
write the database through `assets/crek-db.mjs`, which talks to SQLite (built-in `node:sqlite`),
MySQL / MariaDB (the system `mysql` / `mariadb` client) or this API. Install the app when you want
to browse your own pipeline without asking Claude.

## Three ways to run the plugin

| Level | Requires | What you get |
|---|---|---|
| **1. Database only** | nothing beyond the plugin (Node >= 22.13) | full plugin functionality, no UI |
| **2. Local UI** | PHP CLI with the SQLite PDO driver (Debian/Ubuntu: `php-cli php-sqlite3`) | same, plus the web UI on demand |
| **3. Hosted UI** | PHP + MySQL + web server | UI always up, reachable from any device whose browser can send the token header |

### Level 2 — local UI on SQLite

No web server, no MySQL, no virtual hosts — but **PHP is required**: the PHP command-line
interpreter, >= 7.4, with the SQLite PDO driver. On Debian / Ubuntu:

```bash
sudo apt install php-cli php-sqlite3
php -m | grep -i pdo_sqlite      # must print pdo_sqlite
```

(Fedora: `sudo dnf install php-cli php-pdo`; other systems: any PHP build with `pdo_sqlite`.)

1. **Copy the app out of the plugin** into a directory of your own — for example next to
   `crek.config.json` in your project. The installed plugin lives in a versioned directory that a
   plugin update replaces; your `config.php` must not live there.

   ```bash
   cp -r "<plugin root>/assets/crek-php" ./crek-php     # Claude knows the plugin root
   cd crek-php
   cp config.php.example config.php && chmod 600 config.php
   ```

2. In `config.php`: set `$api_token` (see *Access*), point Option A — active by default — at the
   `crek.db` the plugin already created (an absolute path; `node crek-db.mjs --config
   crek.config.json init` creates it from `skills/apply/references/schema.sqlite.sql`), and
   optionally the UI defaults `$ui_lang` / `$ui_theme`.
3. If your project directory is a git repository, keep `crek-php/config.php` out of it
   (`.gitignore`): it holds the token.
4. From that directory run:

   ```bash
   php -S 127.0.0.1:8080
   ```

Open <http://127.0.0.1:8080/> with the header extension set for that address (*Access*). The
listener only accepts connections from this machine, and the token keeps other local programs and
other sites' pages out; the API also refuses requests that name another host (DNS rebinding) or
come from another site's page. The plugin keeps using the file directly (`db.backend: sqlite`) —
both can run at once.

Stop it with Ctrl-C; the data lives in the database file, not in the server.

**After a plugin update** copy the new `api.php`, `index.php` and `crek-auth.php` over your copy
(keep your `config.php`); the CHANGELOG says when a release changes them.

### Level 3 — hosted UI on MySQL

1. Create a MySQL / MariaDB database and run `skills/apply/references/schema.sql` in it (or
   point the plugin at it with `db.backend: mysql` and run `crek-db.mjs init`).
2. Upload `api.php`, `index.php`, `crek-auth.php` and a filled-in `config.php` (the token, and
   Option B instead of Option A; optionally `$ui_lang` / `$ui_theme`) to a web directory — the
   root of a domain or any subdirectory. On an update, upload the three files again and keep the
   server's `config.php`.
3. Serve it over HTTPS. Optionally put HTTP basic auth in front as a second layer (the token is
   required either way):

   ```
   # .htaccess
   AuthType Basic
   AuthName "Recruitment"
   AuthUserFile /path/to/.htpasswd
   Require valid-user
   ```

4. Point `crek.config.json` at it:
   `"db": {"backend": "http-api", "path_or_url": "https://host/path/api.php", "token": "<the token>"}`
   (plus `"auth": "user:pass"` when basic auth is in front), and set up the browser extension
   (*Access*) — or, if the database port is reachable from your machine, at MySQL directly:
   `"db": {"backend": "mysql", "path_or_url": "mysql://user@host:3306/database?ssl=required", "auth": "user:pass"}`.

## Language and theme

The UI speaks every language the dictionary has (Polish and English) and has a dark and a light
theme. **Defaults** come from `config.php`:

```php
$ui_lang = 'pl';    // or 'en'; unknown codes fall back to 'en'; not set = 'pl'
$ui_theme = 'dark'; // or 'light'; not set = 'dark'
```

**Switches** in the page header change both at once, without a reload; the choice is remembered
in that browser (`localStorage`) and wins over the defaults there. Nothing in `index.php` is edited
for either. Only labels are translated — status values sent to the API (`new`, `applied`,
`interview`, ...) are the same in every language.

The dictionary is an inlined copy of the plugin's `assets/i18n.json`, so the app never reads the
plugin at runtime; a plugin release that changes the dictionary ships a new `index.php` with it.
The same dictionary is the **status list**: the allowed values of `status` are its `ui.status.*`
keys, and the UI builds its status filters, its form and its board columns from them. `api.php`
reads them from `i18n.json` next to it when you deploy that file too, otherwise from the copy
inside `index.php`; an unknown status is refused with HTTP 400 and the list, and so is an empty
one (a status is never cleared). Scores, rates and ids must be whole numbers and dates
`YYYY-MM-DD` — the same rules as the plugin's `crek-db.mjs`.

## Notes

- `api.php` detects the PDO driver and adjusts what differs between engines: the `GROUP_CONCAT`
  separator, `INSERT IGNORE` (SQLite: `INSERT OR IGNORE`) and the contact upsert (`ON DUPLICATE
  KEY UPDATE` / `ON CONFLICT … DO UPDATE`, SQLite >= 3.24). Everything else is portable SQL.
- Writes must be sent as `Content-Type: application/json`; a browser `Origin` must be the app's
  own host (`$allowed_hosts` in `config.php` adds others). Errors come back as
  `{"error": "..."}` with a 4xx/5xx status; database error details — a failed connection
  included — go to the server's error log, never to the client.
- `POST api.php?route=jobs/{id}/append` adds a line to `notes`, `communication`, `meetings` or
  `description` in one UPDATE, so parallel writers never lose a line. The plugin uses it when it
  is there and falls back to read-and-write on an older `api.php`.
- The logs only grow: on MySQL they are `MEDIUMTEXT` (`schema.sql`). A database created by an
  older version keeps `TEXT` (64 KB) until altered — the `ALTER TABLE` is in `schema.sql`.
- Browsers refuse `fetch()` with credentials embedded in the URL — the SPA uses same-origin
  requests with `credentials: 'include'` (for basic auth, when there is one); the token comes from
  the header extension. Already handled in `index.php`.
- Everything the UI shows comes from job postings, i.e. from third parties: it is escaped, and
  only `http(s)` links are made clickable.
- Moving between SQLite and MySQL later means copying the rows: the tables and columns are the
  same in both dialects (`schema.sql`, `schema.sqlite.sql`), but the dump formats differ — export
  with `crek-db.mjs jobs:list` / `contacts:list` from one and re-add with `jobs:add` /
  `contacts:upsert` on the other.
