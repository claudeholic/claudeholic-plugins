-- SPDX-License-Identifier: GPL-3.0-only
-- Job-pipeline database schema (three tables), MySQL / MariaDB dialect.
-- Needs MySQL >= 5.7.22 or MariaDB >= 10.5 (crek-db.mjs uses JSON_OBJECT / JSON_ARRAYAGG).
-- The SQLite dialect of the same tables is schema.sqlite.sql. Both files are executable as they are:
--   node assets/crek-db.mjs --config crek.config.json init     (picks the file by db.backend)
-- Every statement is CREATE ... IF NOT EXISTS, so running it again changes nothing.
-- Status vocabulary for jobs.status:
--   new        – found/recorded, not yet applied
--   applied    – application submitted
--   interview  – any live conversation scheduled or done
--   offer      – offer received
--   rejected   – employer said no
--   declined   – we said no to this posting (record the reason in notes); about the posting
--                only, never a mark against the company
--   skipped    – set aside without review: no decision by the candidate (notes: date +
--                note.skipped from assets/i18n.json). A later scan that meets the same posting again
--                treats it as new; never counts as a rejection or a decline
--   duplicate  – same underlying role as another row (set duplicate_of_id)
--   closed     – the employer stopped taking applications ("No longer accepting applications",
--                expired, archived) before we applied (notes: date + note.closed from
--                assets/i18n.json + evidence). Nobody's no: never counts
--                against the company; a later scan finding the same URL active again sets it
--                back to new
-- jobs.status is a plain VARCHAR (no ENUM, no CHECK): the list above is enforced on write by
-- crek-db.mjs and the bundled api.php, both reading it from the ui.status.* keys of
-- assets/i18n.json — so a new status value needs a dictionary entry, not a migration.
-- The logs (description, notes, communication, meetings) are MEDIUMTEXT: they only grow, and
-- TEXT stops at 64 KB. An older database keeps TEXT until altered:
--   ALTER TABLE jobs MODIFY description MEDIUMTEXT, MODIFY notes MEDIUMTEXT,
--     MODIFY communication MEDIUMTEXT, MODIFY meetings MEDIUMTEXT;

CREATE TABLE IF NOT EXISTS jobs (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) DEFAULT NULL,
  agency VARCHAR(255) DEFAULT NULL,           -- who posted (recruitment agency), NULL if direct
  hiring_company VARCHAR(255) DEFAULT NULL,   -- who actually hires (may be undisclosed)
  source VARCHAR(100) DEFAULT NULL,           -- where found (board name, "LinkedIn outreach", ...)
  source_url TEXT DEFAULT NULL,               -- posting URL
  apply_url TEXT DEFAULT NULL,                -- actual application form URL (often differs!)
  location VARCHAR(255) DEFAULT NULL,
  work_mode VARCHAR(50) DEFAULT NULL,         -- remote | hybrid | onsite (+ free-text nuance)
  salary_min_hour INT DEFAULT NULL,
  salary_max_hour INT DEFAULT NULL,
  salary_min_month INT DEFAULT NULL,
  salary_max_month INT DEFAULT NULL,
  salary_currency VARCHAR(10) DEFAULT 'PLN',
  seniority VARCHAR(50) DEFAULT NULL,
  technologies LONGTEXT DEFAULT NULL CHECK (json_valid(technologies)),  -- JSON array of strings
  description MEDIUMTEXT DEFAULT NULL,        -- condensed posting + fit analysis + gaps
  match_score INT DEFAULT NULL,               -- 1-10
  cv_dir VARCHAR(120) DEFAULT NULL,           -- CV variant directory, '<Company>_<job id>' (file inside is always the same neutral name)
  status VARCHAR(50) DEFAULT 'new',
  applied_date DATE DEFAULT NULL,
  response_date DATE DEFAULT NULL,
  my_rate_min INT DEFAULT NULL,               -- what WE quoted
  my_rate_max INT DEFAULT NULL,
  my_rate_unit VARCHAR(20) DEFAULT NULL,      -- hour | month | year
  my_rate_currency VARCHAR(10) DEFAULT NULL,
  duplicate_of_id INT DEFAULT NULL,
  notes MEDIUMTEXT DEFAULT NULL,
  communication MEDIUMTEXT DEFAULT NULL,      -- append-only dated log (see SKILL.md Step 4)
  meetings MEDIUMTEXT DEFAULT NULL,           -- dated meeting list
  found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY duplicate_of_id (duplicate_of_id),
  CONSTRAINT jobs_ibfk_1 FOREIGN KEY (duplicate_of_id) REFERENCES jobs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contacts (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  role VARCHAR(100) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  linkedin_url TEXT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_person (name, company_name)  -- same person at a new company = new row
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_contacts (
  job_id INT NOT NULL,
  contact_id INT NOT NULL,
  PRIMARY KEY (job_id, contact_id),
  KEY contact_id (contact_id),
  CONSTRAINT job_contacts_ibfk_1 FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
  CONSTRAINT job_contacts_ibfk_2 FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ §API: http-api backend contract ============
-- The bundled PHP app (assets/crek-php) implements this. Base: <url>/api.php?route=...
-- Every request carries the API token in the X-Crek-Token header ($api_token in the server's
-- config.php = db.token in crek.config.json); without it: 401 {"error", "auth": "token"}; with no
-- token configured on the server: 503 for everything. HTTP basic auth of the web server (db.auth
-- as "user:pass") is an optional extra layer, never a replacement. (crek >= 1.10; older servers
-- have no token and rely on basic auth alone.)
-- assets/crek-db.mjs speaks this contract for the http-api backend and offers the same commands
-- on sqlite and mysql, so skills never call the API by hand.
-- NOTE (fetch from a browser/JS): never put credentials in the URL; use credentials:'include'.
-- POST and PUT bodies must be sent as Content-Type: application/json (anything else is refused).
-- status, where given, must be one of the vocabulary above: anything else -> 400 with the list.
--
-- GET    api.php?route=jobs[&status=...][&search=...]  -> [job rows + contact_ids/contact_names]
-- GET    api.php?route=jobs/{id}      -> one job row (+ contact_ids/contact_names), 404 if none
--                                     (crek >= 1.9; older servers answer 404 for every id)
-- POST   api.php?route=jobs           body: any subset of job fields (+ contact_ids: [int])
--                                     -> {"id": n}; 400 when no field is given
-- PUT    api.php?route=jobs/{id}      body: fields to update; contact_ids replaces all links
--                                     -> {"ok": true}, 404 if no such job
--                                     (id goes in the ROUTE, not a query param)
-- POST   api.php?route=jobs/{id}/append  body: {"field": notes|communication|meetings|description,
--                                     "text": "..."} -> {"ok": true}; adds text as a new last line in
--                                     one UPDATE (parallel appends keep every line); 404 "no such job"
--                                     (crek >= 1.10; older servers answer 404 "Not found" — crek-db.mjs
--                                     then reads the row and writes the joined text back)
-- DELETE api.php?route=jobs/{id}      -> {"ok": true}, 404 if no such job
-- GET    api.php?route=contacts       -> [contact rows + job_count]
-- POST   api.php?route=contacts       body: {name, company_name, role?, phone?, email?,
--                                     linkedin_url?, notes?}; upserts on (name, company_name)
--                                     -> {"id": n}; 400 without name / company_name
-- PUT    api.php?route=contacts/{id}  full-row update -> {"ok": true}, 404 if none
-- DELETE api.php?route=contacts/{id}  -> {"ok": true}, 404 if none
-- GET    api.php?route=stats          -> {total, by_status, by_source, avg_match, contacts_count}
-- Errors: {"error": "<message>"} with a 4xx/5xx status; database errors are logged on the server,
-- not returned.
--
-- Gotcha: POST route=jobs ignores empty-string values (treated as absent); PUT converts
-- empty strings to NULL. Servers older than crek 1.9 fail a PUT carrying ONLY contact_ids
-- (empty SET) — crek-db.mjs adds the current status to such a PUT, so it works on both.
