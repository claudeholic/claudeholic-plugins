<?php
// SPDX-License-Identifier: GPL-3.0-only
// CREK REST API (part of the crek plugin for Claude Code). Contract: skills/apply/references/schema.sql §API.
// Works on MySQL / MariaDB and on SQLite (the connection is chosen in config.php).
// Requires PHP >= 7.4; tested on PHP 8.3. Access control: crek-auth.php.

// Nothing but JSON leaves this script: a PHP warning in the body could name paths or credentials.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function fail($code, $message, $extra = []) {
    http_response_code($code);
    echo json_encode(['error' => $message] + $extra);
    exit;
}

/** JSON request body as an array; 400 unless it is a JSON object. */
function body() {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) fail(400, 'request body must be a JSON object');
    return $data;
}

require __DIR__ . '/crek-auth.php';

// config.php sets $api_token and opens the database. A failed connection must not reach the
// client: the exception carries the DSN (host, database, user), so it goes to the server log only.
$dbError = null;
try {
    require __DIR__ . '/config.php';
    if (!isset($db) || !($db instanceof PDO)) throw new RuntimeException('config.php did not set $db to a PDO connection');
} catch (Throwable $e) {
    $dbError = $e;
}

$route = $_GET['route'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$extraHosts = array_map('strtolower', isset($allowed_hosts) && is_array($allowed_hosts) ? $allowed_hosts : []);

// ---------------------------------------------------------------- authentication
// Every request needs the API token ($api_token in config.php) in the X-Crek-Token header —
// its own header, because Authorization belongs to the web server's basic auth when there is
// one. The plugin's scripts send it from db.token, a browser through a header extension (see
// crek-auth.php). Without a configured token the API refuses to work at all.
$apiToken = crek_token($api_token ?? null);
if ($apiToken === '') {
    error_log('crek api.php: ' . crek_token_problem($api_token ?? null) . ' — refusing every request');
    fail(503, 'api.php is not configured: ' . crek_token_problem($api_token ?? null)
        . ' — set it to 32 random bytes in hex (openssl rand -hex 32), see config.php.example; the API refuses to run unprotected');
}
$tokenState = crek_request_token($apiToken);
if ($tokenState === 'missing') fail(401, 'missing X-Crek-Token header (db.token in crek.config.json)', ['auth' => 'token']);
if ($tokenState !== 'ok') fail(401, 'invalid token', ['auth' => 'token']);
if ($dbError) {
    error_log('crek api.php: cannot open the database: ' . $dbError->getMessage());
    fail(500, 'database unavailable (details in the server log)');
}

// ---------------------------------------------------------------- request hygiene
// Cross-site requests and DNS rebinding: a page on another site must not be able to drive this API
// through the user's browser.
// 1. Writes must carry Content-Type: application/json, which a plain HTML form cannot send and which
//    makes a cross-origin fetch() preflight (and this API answers no preflight).
// 2. A browser's Origin, when present, must be this host.
// 3. Under PHP's built-in server (php -S 127.0.0.1:8080, the local setup) a request from this
//    machine must name a loopback host, or one listed in $allowed_hosts in config.php: a DNS
//    rebinding attack arrives on 127.0.0.1 with the attacker's host name. A hosted install is
//    routed by its web server's virtual hosts, so this check stays out of its way (a reverse proxy
//    there may well connect from 127.0.0.1).
$hostHeader = strtolower($_SERVER['HTTP_HOST'] ?? '');
$hostName = preg_match('/^\[([^\]]+)\](:\d+)?$/', $hostHeader, $hm) ? $hm[1] : preg_replace('/:\d+$/', '', $hostHeader);
$loopbackNames = ['localhost', '127.0.0.1', '::1'];
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
$fromLoopback = $remote === '::1' || strpos($remote, '127.') === 0;
if (PHP_SAPI === 'cli-server' && $fromLoopback && !in_array($hostName, $loopbackNames, true) && !in_array($hostName, $extraHosts, true)) {
    fail(403, 'unexpected Host header');
}
if (!crek_origin_ok($extraHosts)) fail(403, 'cross-origin request refused');
if (in_array($method, ['POST', 'PUT'], true)) {
    $ctype = strtolower($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    if (strpos($ctype, 'application/json') !== 0) fail(415, 'send the body as Content-Type: application/json');
}

// ---------------------------------------------------------------- status vocabulary
// One list for the plugin, this API and the UI: the ui.status.* keys of the plugin's i18n.json.
// Read from i18n.json next to this file when it was deployed, else from the copy inlined in
// index.php (deployed with this file anyway).
function crek_statuses() {
    $json = null;
    if (is_readable(__DIR__ . '/i18n.json')) {
        $json = file_get_contents(__DIR__ . '/i18n.json');
    } elseif (is_readable(__DIR__ . '/index.php')) {
        $php = file_get_contents(__DIR__ . '/index.php');
        $start = strpos($php, "json_decode(<<<'JSON'\n");
        $end = $start === false ? false : strpos($php, "\nJSON, true);", $start);
        if ($start !== false && $end !== false) {
            $from = $start + strlen("json_decode(<<<'JSON'\n");
            $json = substr($php, $from, $end - $from);
        }
    }
    $dict = $json === null ? null : json_decode($json, true);
    $out = [];
    foreach (array_keys($dict['en'] ?? []) as $k) {
        if (strpos($k, 'ui.status.') === 0) $out[] = substr($k, strlen('ui.status.'));
    }
    return $out;
}

/** 400 unless $value is a known status. A status is never cleared: '' / null is refused too. */
function check_status($value) {
    $allowed = crek_statuses();
    if (!$allowed) fail(500, 'the status list is unavailable: deploy index.php (or the plugin\'s i18n.json) next to api.php');
    if ($value === '' || $value === null) fail(400, 'status cannot be cleared — give one of: ' . implode(', ', $allowed));
    if (!is_string($value) || !in_array($value, $allowed, true)) {
        fail(400, 'unknown status ' . json_encode($value) . ' — allowed: ' . implode(', ', $allowed));
    }
}

// ---------------------------------------------------------------- column types
// The same checks as crek-db.mjs, so SQLite (which stores anything) and MySQL agree: whole numbers
// for scores, rates and ids (a number or a string of digits), real YYYY-MM-DD dates. '' and null
// pass (skipped on insert, NULL on update).
const CREK_INT_FIELDS = ['salary_min_hour', 'salary_max_hour', 'salary_min_month', 'salary_max_month',
                         'match_score', 'my_rate_min', 'my_rate_max', 'duplicate_of_id'];
const CREK_DATE_FIELDS = ['applied_date', 'response_date'];

/** 400 for the first field of the wrong type. */
function check_types(array $data) {
    foreach (CREK_INT_FIELDS as $f) {
        if (!array_key_exists($f, $data) || $data[$f] === '' || $data[$f] === null) continue;
        $v = $data[$f];
        if (!is_int($v) && !(is_string($v) && preg_match('/^\s*-?\d{1,15}\s*$/', $v))) {
            fail(400, $f . ' must be a whole number, got ' . json_encode($v));
        }
    }
    foreach (CREK_DATE_FIELDS as $f) {
        if (!array_key_exists($f, $data) || $data[$f] === '' || $data[$f] === null) continue;
        $v = $data[$f];
        if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
            fail(400, $f . ' must be a date as YYYY-MM-DD, got ' . json_encode($v));
        }
    }
}

// ---------------------------------------------------------------- dialects

$driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
$sqlite = $driver === 'sqlite';
// GROUP_CONCAT separator syntax, INSERT IGNORE and the contact upsert differ between engines.
$concatNames = $sqlite ? "GROUP_CONCAT(c.name, '||')" : "GROUP_CONCAT(c.name SEPARATOR '||')";
$insertIgnore = $sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
$contactUpsert = $sqlite
    ? "ON CONFLICT(name, company_name) DO UPDATE SET role=excluded.role, phone=excluded.phone, email=excluded.email, linkedin_url=excluded.linkedin_url, notes=excluded.notes"
    : "ON DUPLICATE KEY UPDATE role=VALUES(role), phone=VALUES(phone), email=VALUES(email), linkedin_url=VALUES(linkedin_url), notes=VALUES(notes)";

$jobFields = ['title','agency','hiring_company','source','source_url','apply_url','location',
              'work_mode','salary_min_hour','salary_max_hour','salary_min_month','salary_max_month',
              'salary_currency','seniority','technologies','description','match_score','cv_dir','status',
              'applied_date','response_date','my_rate_min','my_rate_max','my_rate_unit',
              'my_rate_currency','duplicate_of_id','notes','communication','meetings'];
// The append-only logs (POST jobs/{id}/append).
$appendFields = ['notes', 'communication', 'meetings', 'description'];
$jobsSelect = "SELECT j.*, GROUP_CONCAT(c.id) as contact_ids, " . $concatNames . " as contact_names
               FROM jobs j
               LEFT JOIN job_contacts jc ON j.id = jc.job_id
               LEFT JOIN contacts c ON jc.contact_id = c.id";

function exists($db, $table, $id) {
    $stmt = $db->prepare("SELECT 1 FROM $table WHERE id = ?");
    $stmt->execute([$id]);
    return (bool)$stmt->fetchColumn();
}

function linkContacts($db, $insertIgnore, $jobId, $ids) {
    if (!is_array($ids)) return;
    $stmt = $db->prepare("$insertIgnore INTO job_contacts (job_id, contact_id) VALUES (?, ?)");
    foreach ($ids as $cid) {
        if (is_numeric($cid)) $stmt->execute([$jobId, (int)$cid]);
    }
}

try {
    if ($route === 'jobs' && $method === 'GET') {
        $status = $_GET['status'] ?? null;
        $search = $_GET['search'] ?? null;
        $sql = $jobsSelect;
        $where = [];
        $params = [];
        if ($status && $status !== 'all') {
            $where[] = "j.status = ?";
            $params[] = $status;
        }
        if ($search) {
            // Also search description and notes: what identifies a role reposted by another
            // agency (undisclosed client, scope, reference number) is written there in prose,
            // not in the title. Searching titles alone made such duplicates invisible.
            $cols = ['j.title', 'j.hiring_company', 'j.agency', 'j.technologies',
                     'j.description', 'j.notes', 'j.source_url', 'j.apply_url'];
            $where[] = '(' . implode(' OR ', array_map(function ($c) { return "$c LIKE ?"; }, $cols)) . ')';
            $s = "%$search%";
            $params = array_merge($params, array_fill(0, count($cols), $s));
        }
        if ($where) $sql .= " WHERE " . implode(" AND ", $where);
        $sql .= " GROUP BY j.id ORDER BY j.found_at DESC";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        echo json_encode($stmt->fetchAll());

    } elseif (preg_match('#^jobs/(\d+)$#', $route, $m) && $method === 'GET') {
        $stmt = $db->prepare("$jobsSelect WHERE j.id = ? GROUP BY j.id");
        $stmt->execute([$m[1]]);
        $row = $stmt->fetch();
        if (!$row) fail(404, 'no such job');
        echo json_encode($row);

    } elseif ($route === 'jobs' && $method === 'POST') {
        $data = body();
        $cols = []; $placeholders = []; $vals = [];
        foreach ($jobFields as $f) {
            if (isset($data[$f]) && $data[$f] !== '') {
                $cols[] = $f;
                $placeholders[] = '?';
                $vals[] = $data[$f];
            }
        }
        if (!$cols) fail(400, 'nothing to insert: give at least one job field');
        if (isset($data['status']) && $data['status'] !== '') check_status($data['status']);
        check_types($data);
        $db->beginTransaction();
        $stmt = $db->prepare("INSERT INTO jobs (" . implode(',', $cols) . ") VALUES (" . implode(',', $placeholders) . ")");
        $stmt->execute($vals);
        $jobId = $db->lastInsertId();
        if (!empty($data['contact_ids'])) linkContacts($db, $insertIgnore, $jobId, $data['contact_ids']);
        $db->commit();
        echo json_encode(['id' => (int)$jobId]);

    } elseif (preg_match('#^jobs/(\d+)$#', $route, $m) && $method === 'PUT') {
        $id = $m[1];
        $data = body();
        if (array_key_exists('status', $data)) check_status($data['status']);
        check_types($data);
        if (!exists($db, 'jobs', $id)) fail(404, 'no such job');
        $sets = []; $vals = [];
        foreach ($jobFields as $f) {
            if (array_key_exists($f, $data)) {
                $sets[] = "$f = ?";
                $vals[] = $data[$f] === '' ? null : $data[$f];
            }
        }
        $db->beginTransaction();
        if ($sets) {
            $vals[] = $id;
            $db->prepare("UPDATE jobs SET " . implode(',', $sets) . " WHERE id = ?")->execute($vals);
        }
        if (array_key_exists('contact_ids', $data)) {
            $db->prepare("DELETE FROM job_contacts WHERE job_id = ?")->execute([$id]);
            if (!empty($data['contact_ids'])) linkContacts($db, $insertIgnore, $id, $data['contact_ids']);
        }
        $db->commit();
        echo json_encode(['ok' => true]);

    } elseif (preg_match('#^jobs/(\d+)/append$#', $route, $m) && $method === 'POST') {
        // Appends a line to one of the logs in a single UPDATE, so two writers appending at the
        // same moment both keep their line (a read-modify-write PUT would lose one).
        $data = body();
        $field = $data['field'] ?? null;
        $text = is_string($data['text'] ?? null) ? trim($data['text']) : '';
        if (!in_array($field, $appendFields, true)) fail(400, 'field must be one of: ' . implode(', ', $appendFields));
        if ($text === '') fail(400, 'text must be a non-empty string');
        $joined = $sqlite
            ? "CASE WHEN $field IS NULL OR $field = '' THEN ? ELSE rtrim($field, char(32, 9, 10, 13)) || char(10) || ? END"
            : "IF($field IS NULL OR $field = '', ?, CONCAT(RTRIM(TRIM(TRAILING CHAR(10 USING utf8mb4) FROM RTRIM($field))), CHAR(10 USING utf8mb4), ?))";
        $stmt = $db->prepare("UPDATE jobs SET $field = $joined WHERE id = ?");
        $stmt->execute([$text, $text, $m[1]]);
        if ($stmt->rowCount() === 0) fail(404, 'no such job');
        echo json_encode(['ok' => true]);

    } elseif (preg_match('#^jobs/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $stmt = $db->prepare("DELETE FROM jobs WHERE id = ?");
        $stmt->execute([$m[1]]);
        if ($stmt->rowCount() === 0) fail(404, 'no such job');
        echo json_encode(['ok' => true]);

    } elseif ($route === 'contacts' && $method === 'GET') {
        $stmt = $db->query("SELECT c.*, COUNT(jc.job_id) as job_count FROM contacts c LEFT JOIN job_contacts jc ON c.id = jc.contact_id GROUP BY c.id ORDER BY c.name");
        echo json_encode($stmt->fetchAll());

    } elseif ($route === 'contacts' && $method === 'POST') {
        $data = body();
        if (empty($data['name']) || empty($data['company_name'])) fail(400, 'a contact needs name and company_name');
        $stmt = $db->prepare("INSERT INTO contacts (name, company_name, role, phone, email, linkedin_url, notes) VALUES (?,?,?,?,?,?,?) $contactUpsert");
        $stmt->execute([$data['name'], $data['company_name'], $data['role'] ?? null, $data['phone'] ?? null,
                        $data['email'] ?? null, $data['linkedin_url'] ?? null, $data['notes'] ?? null]);
        // lastInsertId() says nothing useful after an upsert that updated: look the row up.
        $find = $db->prepare("SELECT id FROM contacts WHERE name = ? AND company_name = ?");
        $find->execute([$data['name'], $data['company_name']]);
        echo json_encode(['id' => (int)$find->fetchColumn()]);

    } elseif (preg_match('#^contacts/(\d+)$#', $route, $m) && $method === 'PUT') {
        $data = body();
        if (empty($data['name']) || empty($data['company_name'])) fail(400, 'a contact needs name and company_name');
        if (!exists($db, 'contacts', $m[1])) fail(404, 'no such contact');
        $db->prepare("UPDATE contacts SET name=?, company_name=?, role=?, phone=?, email=?, linkedin_url=?, notes=? WHERE id=?")
           ->execute([$data['name'], $data['company_name'], $data['role'] ?? null, $data['phone'] ?? null,
                      $data['email'] ?? null, $data['linkedin_url'] ?? null, $data['notes'] ?? null, $m[1]]);
        echo json_encode(['ok' => true]);

    } elseif (preg_match('#^contacts/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $stmt = $db->prepare("DELETE FROM contacts WHERE id = ?");
        $stmt->execute([$m[1]]);
        if ($stmt->rowCount() === 0) fail(404, 'no such contact');
        echo json_encode(['ok' => true]);

    } elseif ($route === 'stats' && $method === 'GET') {
        $stats = [];
        $stats['total'] = $db->query("SELECT COUNT(*) FROM jobs")->fetchColumn();
        $stats['by_status'] = $db->query("SELECT status, COUNT(*) as count FROM jobs GROUP BY status")->fetchAll();
        $stats['by_source'] = $db->query("SELECT source, COUNT(*) as count FROM jobs GROUP BY source ORDER BY count DESC")->fetchAll();
        $stats['avg_match'] = $db->query("SELECT ROUND(AVG(CASE WHEN match_score > 10 THEN match_score / 10.0 ELSE match_score END), 1) FROM jobs WHERE match_score IS NOT NULL")->fetchColumn();
        $stats['contacts_count'] = $db->query("SELECT COUNT(*) FROM contacts")->fetchColumn();
        echo json_encode($stats);

    } else {
        fail(404, 'Not found');
    }
} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    // The details go to the server log, not to the client: they can name tables, columns and paths.
    error_log('crek api.php: ' . $method . ' ' . $route . ': ' . $e->getMessage());
    fail(500, 'database error (details in the server log)');
}
