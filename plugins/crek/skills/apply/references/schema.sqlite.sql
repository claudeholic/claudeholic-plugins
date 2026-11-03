-- SPDX-License-Identifier: GPL-3.0-only
-- Job-pipeline database schema, SQLite dialect: the same three tables and columns as schema.sql
-- (MySQL / MariaDB), where the status vocabulary and the column comments live.
-- Executable as it is: node assets/crek-db.mjs --config crek.config.json init
-- Every statement is ... IF NOT EXISTS, so running it again changes nothing.
--
-- Differences from MySQL, handled here:
--   * found_at / updated_at are local time (datetime('now', 'localtime')), like MySQL's
--     CURRENT_TIMESTAMP on a server in the candidate's time zone; plain CURRENT_TIMESTAMP in
--     SQLite would be UTC and shift job-scan's time window by an hour or two.
--   * updated_at has no ON UPDATE clause in SQLite: the jobs_updated_at trigger does it.
--   * Foreign keys work only with PRAGMA foreign_keys = ON on each connection (crek-db.mjs and
--     config.php.example set it).

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  agency TEXT,
  hiring_company TEXT,
  source TEXT,
  source_url TEXT,
  apply_url TEXT,
  location TEXT,
  work_mode TEXT,
  salary_min_hour INTEGER,
  salary_max_hour INTEGER,
  salary_min_month INTEGER,
  salary_max_month INTEGER,
  salary_currency TEXT DEFAULT 'PLN',
  seniority TEXT,
  technologies TEXT CHECK (json_valid(technologies)),   -- JSON array of strings
  description TEXT,
  match_score INTEGER,
  cv_dir TEXT,
  status TEXT DEFAULT 'new',
  applied_date TEXT,                                    -- YYYY-MM-DD
  response_date TEXT,                                   -- YYYY-MM-DD
  my_rate_min INTEGER,
  my_rate_max INTEGER,
  my_rate_unit TEXT,
  my_rate_currency TEXT,
  duplicate_of_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  notes TEXT,
  communication TEXT,
  meetings TEXT,
  found_at TEXT DEFAULT (datetime('now', 'localtime')), -- YYYY-MM-DD HH:MM:SS
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS jobs_duplicate_of_id ON jobs (duplicate_of_id);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status);

CREATE TRIGGER IF NOT EXISTS jobs_updated_at AFTER UPDATE ON jobs
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE jobs SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  linkedin_url TEXT,
  notes TEXT,
  UNIQUE (name, company_name)                           -- same person at a new company = new row
);

CREATE TABLE IF NOT EXISTS job_contacts (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, contact_id)
);
CREATE INDEX IF NOT EXISTS job_contacts_contact_id ON job_contacts (contact_id);
