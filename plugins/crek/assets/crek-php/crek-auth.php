<?php
// SPDX-License-Identifier: GPL-3.0-only
// CREK web app — access control shared by index.php and api.php (part of the crek plugin for Claude Code).
//
// Nothing in the app answers without the API token from config.php ($api_token), sent in the
// X-Crek-Token header on EVERY request: the plugin's scripts send it themselves (db.token in
// crek.config.json), a browser through a header extension (e.g. ModHeader) set for this site.
// No form, no session, no cookie, never in a URL. The web server's basic auth, when configured,
// is an extra layer in front of this, never a replacement. With no token configured, both
// index.php and api.php refuse to work.

/** 32 random bytes in hex: `openssl rand -hex 32`. Shorter tokens are refused. */
const CREK_MIN_TOKEN = 64;
/**
 * Pause before answering a missing or wrong token. Short on purpose: a 256-bit token cannot be
 * guessed anyway, and `php -S` (the local UI) answers one request at a time, so a long pause on
 * every token-less request (a favicon, a prefetch, another tab) would stall the whole app.
 */
const CREK_WRONG_TOKEN_DELAY_US = 200000;

/** The configured token, or '' when it is missing or too short (the caller refuses then). */
function crek_token($configured) {
    return is_string($configured) && strlen($configured) >= CREK_MIN_TOKEN ? $configured : '';
}

/** Why the configured token is unusable, for the server log and the error message. */
function crek_token_problem($configured) {
    if ($configured === null || $configured === '') return '$api_token is not set in config.php';
    if (!is_string($configured)) return '$api_token in config.php must be a string';
    return '$api_token in config.php is shorter than ' . CREK_MIN_TOKEN . ' characters';
}

/**
 * Check the X-Crek-Token header of this request against the configured token (constant time).
 * Returns 'ok', 'missing' or 'wrong'; anything but 'ok' has already cost the caller a pause.
 */
function crek_request_token($token) {
    $sent = $_SERVER['HTTP_X_CREK_TOKEN'] ?? '';
    if ($token !== '' && is_string($sent) && $sent !== '' && hash_equals($token, $sent)) return 'ok';
    usleep(CREK_WRONG_TOKEN_DELAY_US);
    return (is_string($sent) && $sent !== '') ? 'wrong' : 'missing';
}

/** A browser Origin, when present, must be this host (or one of $allowed_hosts). */
function crek_origin_ok($extraHosts) {
    if (!isset($_SERVER['HTTP_ORIGIN'])) return true;
    $origin = parse_url($_SERVER['HTTP_ORIGIN']);
    $originHost = strtolower(($origin['host'] ?? '') . (isset($origin['port']) ? ':' . $origin['port'] : ''));
    $hostHeader = strtolower($_SERVER['HTTP_HOST'] ?? '');
    return $originHost !== '' && ($originHost === $hostHeader || in_array($originHost, $extraHosts, true));
}
