<?php
// SPDX-License-Identifier: GPL-3.0-only
// CREK web UI (part of the crek plugin for Claude Code). Talks to api.php in the same directory.
//
// Access: every request must carry $api_token from config.php in the X-Crek-Token header (in a
// browser: a header extension such as ModHeader, see README.md). Without it the answer is one line
// of text — no data, no application code (crek-auth.php). The token is never written into a page.
//
// UI language and theme: the defaults come from config.php ($ui_lang: a code with a dictionary
// below, 'pl' or 'en', unknown codes fall back to 'en'; $ui_theme: 'dark' or 'light'). The page has
// switches for both; a choice made there is kept in the browser (localStorage) and wins over the
// defaults. Nothing to edit in this file.

ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');

// Inlined copy of assets/i18n.json from the crek plugin. The app is deployed as single files, so it
// must not read the plugin at runtime. For the plugin's developers: when i18n.json changes, paste the
// new content here (tests/i18n.test.mjs fails until the copy is exact). Users never edit this file.
$CREK_I18N = json_decode(<<<'JSON'
{
  "en": {
    "language_names": ["english", "angielski"],

    "report.col.tab": "Tab",
    "report.col.posting": "Posting",
    "report.col.rate": "Rate",
    "report.col.match": "Match",
    "report.col.pros": "Pros",
    "report.col.cons": "Cons",
    "report.col.comments": "Comments",
    "report.section.in_pipeline": "Already in the pipeline",
    "report.section.verdict": "Verdict",
    "report.section.boards": "Boards scanned",
    "report.section.boards_disabled": "Skipped — disabled in config",
    "report.section.dropped": "Dropped at title level",
    "report.section.closed": "Closed by the employer — taken out of the batch",
    "report.unit.hour": "/h",
    "report.unit.day": "/day",
    "report.unit.month": "/mo",
    "report.value.not_disclosed": "not disclosed",
    "report.value.employment_only": "employment contract only",
    "report.value.core_tech_blocker": "{tech} as the core of the role",
    "report.value.suggest_apply": "apply",
    "report.value.suggest_skip": "skip",
    "report.value.accepted": "accepted",
    "report.value.revisit_later": "revisit later {date}",
    "report.value.repost_first_published": "repost — first published {date}",
    "report.value.possibly_same_client": "possibly the same client as #{id} {agency}, {history}",
    "report.value.likely_same_posting": "likely the same posting as #{id} {agency}, {history}",
    "report.value.previously_skipped": "previously skipped without review (#{id}, {date})",
    "report.value.closed": "closed — no longer accepting applications (checked {checked})",
    "report.value.no_response": "no response",
    "report.value.same_posting": "the same posting",
    "report.value.earlier_rejection": "earlier rejection #{id}, {date}",
    "report.value.different_client": "different client",
    "report.value.batch_count": "{shown} of {total}",

    "comm.no_account": "no account",
    "comm.account_used": "{portal} account",
    "comm.new_account": "new {portal} account (password in the config)",

    "note.skipped": "skipped without review",
    "note.declined": "declined — not interested",
    "note.back_to_new_seen_again": "back to new — seen again in a scan, previously skipped without review",
    "note.back_to_new_reopened": "back to new — reopened by the employer",
    "note.closed": "closed — no longer accepting applications (checked {checked})",
    "note.duplicate": "hard duplicate of #{id} — shared: {refs}",

    "match.header": "# crek-match — entries in the archive: {entries}, postings to check: {candidates}",
    "match.same_url": "same URL",
    "match.same_url_other_company": "same URL, but a different company ({ours} vs {theirs}) — not proof of the same posting, check",
    "match.same_url_no_id": "same {ats} form address, but no shared posting id — not proof of the same posting",
    "match.ref": "ref {ref}",
    "match.same_form": "same application form {ref}",
    "match.ref_weak": "short id {ref} also there, but another company — not proof",
    "match.duplicate_of": "duplicate of #{id}",
    "match.salary_overlap": "rate ranges overlap",
    "match.same_location": "same location",
    "match.company": "company: {names}",
    "match.likely_same_posting": "likely the same posting (agency, title, rate)",
    "match.likely_same_posting_no_rate": "likely the same posting (agency, title; no rate to compare)",
    "match.previously_skipped": "previously skipped without review — no decision, present as new",
    "match.previously_closed": "closed by the employer earlier — if the posting is active again, it reopened: reuse that row",
    "match.shared": "shared: {tokens}",
    "match.nothing_similar": "(nothing similar in the archive)",
    "match.legend": "!! same URL, reference number or application form id: a duplicate. ! likely the same posting (same agency and title, rates overlap): not a duplicate, but suggest skip when that entry was applied to. ! also marks a shared URL that proves nothing — the same URL under two different companies, or the same ATS form address without a shared posting id: not a duplicate, check it.",
    "match.legend_skipped": "~~ / ~ the same kind of hit, but that entry was skipped without review: no decision by the candidate — not a duplicate, not declined, no skip suggestion; present the posting as new.",
    "match.closing": "This is material to read, not a verdict — deciding whether it is the same role is up to you.",

    "closed.state.closed": "closed",
    "closed.state.open": "open",
    "closed.state.unknown": "unknown",
    "closed.summary": "# crek-closed-check {checked}: closed: {closed}, open: {open}, unknown: {unknown} (of {total})",

    "dedupe.verdict.duplicate": "duplicate",
    "dedupe.verdict.in_pipeline": "already in the pipeline",
    "dedupe.verdict.keep": "keep",
    "dedupe.verdict.unknown": "unknown",
    "dedupe.refs": "refs",
    "dedupe.note.duplicate": "hard duplicate of #{id} {agency} ({status} {date}) — shared: {evidence} (checked {checked})",
    "dedupe.note.in_pipeline": "likely the same posting as #{id} {agency}, {status} {date} — taken out of the batch (checked {checked})",
    "dedupe.note.url_suspect": "#{id} {agency}: {reason}; not a duplicate, stays in the batch (checked {checked})",
    "dedupe.summary": "# crek-dedupe-check {checked}: duplicates: {duplicate}, already in the pipeline: {in_pipeline}, to show: {keep}, unknown: {unknown} (of {total})",

    "ui.page_title": "CREK — Recruitment",
    "ui.lang.label": "Language",
    "ui.theme.label": "Theme",
    "ui.theme.dark": "Dark",
    "ui.theme.light": "Light",
    "ui.add_job": "+ Posting",
    "ui.add_contact": "+ Contact",
    "ui.tab.kanban": "Kanban",
    "ui.tab.table": "Table",
    "ui.tab.contacts": "Contacts",
    "ui.search_placeholder": "Search by title, company, technology...",
    "ui.filter.all_statuses": "All statuses",
    "ui.status.new": "New",
    "ui.status.applied": "Applied",
    "ui.status.interview": "Interview",
    "ui.status.offer": "Offer",
    "ui.status.rejected": "Rejected",
    "ui.status.declined": "Declined",
    "ui.status.skipped": "Skipped (not reviewed)",
    "ui.status.closed": "Closed by employer",
    "ui.status.duplicate": "Duplicate",
    "ui.col.title": "Title",
    "ui.col.company": "Company",
    "ui.col.agency": "Agency",
    "ui.col.source": "Source",
    "ui.col.rate": "Rate",
    "ui.col.mode": "Mode",
    "ui.col.score": "Score",
    "ui.col.status": "Status",
    "ui.col.date": "Date",
    "ui.job.new": "New posting",
    "ui.job.edit": "Edit posting",
    "ui.job.delete_confirm": "Delete this posting?",
    "ui.field.title": "Job title",
    "ui.field.hiring_company": "Hiring company",
    "ui.field.agency": "Agency",
    "ui.field.source": "Source",
    "ui.field.source_url": "Posting URL",
    "ui.field.apply_url": "Application form URL",
    "ui.field.location": "Location",
    "ui.field.work_mode": "Work mode",
    "ui.field.seniority": "Seniority",
    "ui.field.currency": "Currency",
    "ui.field.rate_hour_min": "Rate/h min",
    "ui.field.rate_hour_max": "Rate/h max",
    "ui.field.rate_month_min": "Rate/month min",
    "ui.field.rate_month_max": "Rate/month max",
    "ui.field.technologies": "Technologies (comma-separated)",
    "ui.field.match_score": "Match score (1-10)",
    "ui.field.cv_dir": "CV directory",
    "ui.field.cv_dir_placeholder": "e.g. AcmeCorp_37",
    "ui.field.status": "Status",
    "ui.field.applied_date": "Applied on",
    "ui.field.response_date": "Response date",
    "ui.field.my_rate_min": "My rate min",
    "ui.field.my_rate_max": "My rate max",
    "ui.field.my_rate_unit": "Rate unit",
    "ui.field.my_rate_currency": "Rate currency",
    "ui.field.description": "Posting description",
    "ui.field.communication": "Communication",
    "ui.field.communication_placeholder": "who, when, channel: content...",
    "ui.field.meetings": "Meetings",
    "ui.field.meetings_placeholder": "date time people - meeting type",
    "ui.field.notes": "Notes",
    "ui.unit.hour": "Hourly",
    "ui.unit.day": "Daily",
    "ui.unit.month": "Monthly",
    "ui.per_month": "/mo",
    "ui.via": "via",
    "ui.btn.cancel": "Cancel",
    "ui.btn.save": "Save",
    "ui.btn.delete": "Delete",
    "ui.btn.close": "Close",
    "ui.btn.edit": "Edit",
    "ui.contact.new": "New contact",
    "ui.contact.edit": "Edit contact",
    "ui.contact.delete_confirm": "Delete this contact?",
    "ui.contact.name": "Full name",
    "ui.contact.company": "Company",
    "ui.contact.role": "Role",
    "ui.contact.role_placeholder": "recruiter, tech, HR...",
    "ui.contact.phone": "Phone",
    "ui.contact.email": "Email",
    "ui.contact.linkedin": "LinkedIn",
    "ui.contact.notes": "Notes",
    "ui.contact.job_count": "postings: {n}",
    "ui.contact.none": "No contacts",
    "ui.stats.postings": "Postings",
    "ui.stats.applied": "Applied",
    "ui.stats.interviews": "Interviews",
    "ui.stats.offers": "Offers",
    "ui.stats.avg_match": "Avg. match",
    "ui.stats.contacts": "Contacts",
    "ui.view.company": "Company",
    "ui.view.agency": "Agency",
    "ui.view.source": "Source",
    "ui.view.link": "Link",
    "ui.view.form": "Form",
    "ui.view.location": "Location",
    "ui.view.seniority": "Seniority",
    "ui.view.rate": "Rate",
    "ui.view.my_rate": "My rate",
    "ui.view.match": "Match",
    "ui.view.cv": "CV",
    "ui.view.technologies": "Technologies",
    "ui.view.description": "Description",
    "ui.view.communication": "Communication",
    "ui.view.meetings": "Meetings",
    "ui.view.contacts": "Contacts",
    "ui.view.notes": "Notes",
    "ui.view.found": "Found",
    "ui.view.applied": "Applied",
    "ui.view.response": "Response",
    "ui.error.api": "The pipeline did not answer as expected: {message}",
    "ui.error.save": "Not saved: {message}",
    "ui.auth.missing": "This page needs the API token in the X-Crek-Token header. Send it with a header extension in the browser (e.g. ModHeader) — see crek-php/README.md.",
    "ui.auth.invalid": "Invalid token.",
    "ui.auth.not_configured": "The app is not configured: {problem}. Set $api_token in config.php to 32 random bytes in hex (openssl rand -hex 32) — the app does not run unprotected."
  },
  "pl": {
    "language_names": ["polish", "polski"],

    "report.col.tab": "Tab",
    "report.col.posting": "Oferta",
    "report.col.rate": "Stawka",
    "report.col.match": "Dopasow.",
    "report.col.pros": "Plusy",
    "report.col.cons": "Minusy",
    "report.col.comments": "Komentarze",
    "report.section.in_pipeline": "Już w pipeline",
    "report.section.verdict": "Werdykt",
    "report.section.boards": "Przeszukane portale",
    "report.section.boards_disabled": "Pominięte — wyłączone w configu",
    "report.section.dropped": "Odrzucone po tytule",
    "report.section.closed": "Zamknięte przez pracodawcę — wyjęte z partii",
    "report.unit.hour": "/h",
    "report.unit.day": "/dzień",
    "report.unit.month": "/mies",
    "report.value.not_disclosed": "nie podano",
    "report.value.employment_only": "tylko UoP",
    "report.value.core_tech_blocker": "{tech} jako rdzeń roli",
    "report.value.suggest_apply": "aplikuj",
    "report.value.suggest_skip": "odpuść",
    "report.value.accepted": "zaakceptowane",
    "report.value.revisit_later": "przemyślę później {date}",
    "report.value.repost_first_published": "repost — pierwotnie {date}",
    "report.value.possibly_same_client": "możliwie ten sam klient co #{id} {agency}, {history}",
    "report.value.likely_same_posting": "najpewniej to samo ogłoszenie co #{id} {agency}, {history}",
    "report.value.previously_skipped": "wcześniej pominięte bez przeglądu (#{id}, {date})",
    "report.value.closed": "zamknięte — nie przyjmuje już zgłoszeń (sprawdzone {checked})",
    "report.value.no_response": "bez odpowiedzi",
    "report.value.same_posting": "to samo ogłoszenie",
    "report.value.earlier_rejection": "odrzucenie #{id}, {date}",
    "report.value.different_client": "inny klient",
    "report.value.batch_count": "{shown} z {total}",

    "comm.no_account": "bez konta",
    "comm.account_used": "konto {portal}",
    "comm.new_account": "nowe konto {portal} (hasło w configu)",

    "note.skipped": "pominięte bez przeglądu",
    "note.declined": "odrzucone — kandydat niezainteresowany",
    "note.back_to_new_seen_again": "wraca do new — znów w skanie, wcześniej pominięte bez przeglądu",
    "note.back_to_new_reopened": "wraca do new — pracodawca znów przyjmuje zgłoszenia",
    "note.closed": "zamknięte — nie przyjmuje już zgłoszeń (sprawdzone {checked})",
    "note.duplicate": "twardy duplikat #{id} — wspólne: {refs}",

    "match.header": "# crek-match — wpisy w archiwum: {entries}, ogłoszenia do sprawdzenia: {candidates}",
    "match.same_url": "ten sam URL",
    "match.same_url_other_company": "ten sam URL, ale inna firma ({ours} vs {theirs}) — to nie dowód, że to samo ogłoszenie, sprawdź",
    "match.same_url_no_id": "ten sam adres formularza {ats}, ale bez wspólnego identyfikatora oferty — to nie dowód, że to samo ogłoszenie",
    "match.ref": "ref {ref}",
    "match.same_form": "ten sam formularz aplikacyjny {ref}",
    "match.ref_weak": "krótki identyfikator {ref} też tam, ale inna firma — nie dowód",
    "match.duplicate_of": "duplikat #{id}",
    "match.salary_overlap": "widełki się pokrywają",
    "match.same_location": "ta sama lokalizacja",
    "match.company": "firma: {names}",
    "match.likely_same_posting": "najpewniej to samo ogłoszenie (agencja, tytuł, stawka)",
    "match.likely_same_posting_no_rate": "najpewniej to samo ogłoszenie (agencja, tytuł; brak stawki do porównania)",
    "match.previously_skipped": "wcześniej pominięte bez przeglądu — bez decyzji, pokaż jako nowe",
    "match.previously_closed": "wcześniej zamknięte przez pracodawcę — jeśli oferta znów jest aktywna, wróciła: użyj tamtego wiersza",
    "match.shared": "wspólne: {tokens}",
    "match.nothing_similar": "(nic podobnego w archiwum)",
    "match.legend": "!! ten sam URL, numer referencyjny lub identyfikator formularza aplikacyjnego: duplikat. ! najpewniej to samo ogłoszenie (ta sama agencja i tytuł, widełki się pokrywają): nie duplikat, ale sugestia odpuść, jeśli na tamto już aplikowano. ! oznacza też wspólny URL, który niczego nie dowodzi — ten sam URL u dwóch różnych firm albo ten sam adres formularza ATS bez wspólnego identyfikatora oferty: nie duplikat, sprawdź.",
    "match.legend_skipped": "~~ / ~ trafienie tego samego rodzaju, ale tamten wpis pominięto bez przeglądu: kandydat nic nie zdecydował — nie duplikat, nie odmowa, bez sugestii odpuść; pokaż ofertę jako nową.",
    "match.closing": "To jest materiał do przeczytania, nie werdykt — ocena, czy to ta sama rola, należy do Ciebie.",

    "closed.state.closed": "zamknięte",
    "closed.state.open": "otwarte",
    "closed.state.unknown": "nie wiadomo",
    "closed.summary": "# crek-closed-check {checked}: zamknięte: {closed}, otwarte: {open}, nieustalone: {unknown} (z {total})",

    "dedupe.verdict.duplicate": "duplikat",
    "dedupe.verdict.in_pipeline": "już w pipeline",
    "dedupe.verdict.keep": "zostaje",
    "dedupe.verdict.unknown": "nie wiadomo",
    "dedupe.refs": "numery",
    "dedupe.note.duplicate": "twardy duplikat #{id} {agency} ({status} {date}) — wspólne: {evidence} (sprawdzone {checked})",
    "dedupe.note.in_pipeline": "najpewniej to samo ogłoszenie co #{id} {agency}, {status} {date} — wyjęte z partii (sprawdzone {checked})",
    "dedupe.note.url_suspect": "#{id} {agency}: {reason}; nie duplikat, zostaje w partii (sprawdzone {checked})",
    "dedupe.summary": "# crek-dedupe-check {checked}: duplikaty: {duplicate}, już w pipeline: {in_pipeline}, do pokazania: {keep}, nieustalone: {unknown} (z {total})",

    "ui.page_title": "CREK — Rekrutacje",
    "ui.lang.label": "Język",
    "ui.theme.label": "Motyw",
    "ui.theme.dark": "Ciemny",
    "ui.theme.light": "Jasny",
    "ui.add_job": "+ Ogłoszenie",
    "ui.add_contact": "+ Kontakt",
    "ui.tab.kanban": "Kanban",
    "ui.tab.table": "Tabela",
    "ui.tab.contacts": "Kontakty",
    "ui.search_placeholder": "Szukaj po tytule, firmie, technologii...",
    "ui.filter.all_statuses": "Wszystkie statusy",
    "ui.status.new": "Nowe",
    "ui.status.applied": "Wysłane",
    "ui.status.interview": "Rozmowa",
    "ui.status.offer": "Oferta",
    "ui.status.rejected": "Odrzucone",
    "ui.status.declined": "Odmówione",
    "ui.status.skipped": "Pominięte (bez przeglądu)",
    "ui.status.closed": "Zamknięte przez pracodawcę",
    "ui.status.duplicate": "Duplikat",
    "ui.col.title": "Tytuł",
    "ui.col.company": "Firma",
    "ui.col.agency": "Agencja",
    "ui.col.source": "Źródło",
    "ui.col.rate": "Stawka",
    "ui.col.mode": "Tryb",
    "ui.col.score": "Score",
    "ui.col.status": "Status",
    "ui.col.date": "Data",
    "ui.job.new": "Nowe ogłoszenie",
    "ui.job.edit": "Edytuj ogłoszenie",
    "ui.job.delete_confirm": "Usunąć ogłoszenie?",
    "ui.field.title": "Tytuł stanowiska",
    "ui.field.hiring_company": "Firma docelowa",
    "ui.field.agency": "Agencja",
    "ui.field.source": "Źródło",
    "ui.field.source_url": "URL ogłoszenia",
    "ui.field.apply_url": "URL formularza",
    "ui.field.location": "Lokalizacja",
    "ui.field.work_mode": "Tryb pracy",
    "ui.field.seniority": "Seniority",
    "ui.field.currency": "Waluta",
    "ui.field.rate_hour_min": "Stawka/h min",
    "ui.field.rate_hour_max": "Stawka/h max",
    "ui.field.rate_month_min": "Stawka/mies. min",
    "ui.field.rate_month_max": "Stawka/mies. max",
    "ui.field.technologies": "Technologie (przecinkami)",
    "ui.field.match_score": "Dopasowanie (1-10)",
    "ui.field.cv_dir": "Katalog CV",
    "ui.field.cv_dir_placeholder": "np. AcmeCorp_37",
    "ui.field.status": "Status",
    "ui.field.applied_date": "Data aplikacji",
    "ui.field.response_date": "Data odpowiedzi",
    "ui.field.my_rate_min": "Moja stawka min",
    "ui.field.my_rate_max": "Moja stawka max",
    "ui.field.my_rate_unit": "Jednostka stawki",
    "ui.field.my_rate_currency": "Waluta stawki",
    "ui.field.description": "Opis ogłoszenia",
    "ui.field.communication": "Komunikacja",
    "ui.field.communication_placeholder": "kto, kiedy, kanał: treść...",
    "ui.field.meetings": "Spotkania",
    "ui.field.meetings_placeholder": "data godzina osoby - typ spotkania",
    "ui.field.notes": "Notatki",
    "ui.unit.hour": "Godzinowa",
    "ui.unit.day": "Dzienna",
    "ui.unit.month": "Miesięczna",
    "ui.per_month": "/mies",
    "ui.via": "via",
    "ui.btn.cancel": "Anuluj",
    "ui.btn.save": "Zapisz",
    "ui.btn.delete": "Usuń",
    "ui.btn.close": "Zamknij",
    "ui.btn.edit": "Edytuj",
    "ui.contact.new": "Nowy kontakt",
    "ui.contact.edit": "Edytuj kontakt",
    "ui.contact.delete_confirm": "Usunąć kontakt?",
    "ui.contact.name": "Imię i nazwisko",
    "ui.contact.company": "Firma",
    "ui.contact.role": "Rola",
    "ui.contact.role_placeholder": "recruiter, tech, HR...",
    "ui.contact.phone": "Telefon",
    "ui.contact.email": "Email",
    "ui.contact.linkedin": "LinkedIn",
    "ui.contact.notes": "Notatki",
    "ui.contact.job_count": "ogłoszenia: {n}",
    "ui.contact.none": "Brak kontaktów",
    "ui.stats.postings": "Ogłoszenia",
    "ui.stats.applied": "Wysłane",
    "ui.stats.interviews": "Rozmowy",
    "ui.stats.offers": "Oferty",
    "ui.stats.avg_match": "Śr. match",
    "ui.stats.contacts": "Kontakty",
    "ui.view.company": "Firma",
    "ui.view.agency": "Agencja",
    "ui.view.source": "Źródło",
    "ui.view.link": "Link",
    "ui.view.form": "Formularz",
    "ui.view.location": "Lokalizacja",
    "ui.view.seniority": "Seniority",
    "ui.view.rate": "Stawka",
    "ui.view.my_rate": "Moja stawka",
    "ui.view.match": "Match",
    "ui.view.cv": "CV",
    "ui.view.technologies": "Technologie",
    "ui.view.description": "Opis",
    "ui.view.communication": "Komunikacja",
    "ui.view.meetings": "Spotkania",
    "ui.view.contacts": "Kontakty",
    "ui.view.notes": "Notatki",
    "ui.view.found": "Znalezione",
    "ui.view.applied": "Aplikacja",
    "ui.view.response": "Odpowiedź",
    "ui.error.api": "Pipeline nie odpowiedział poprawnie: {message}",
    "ui.error.save": "Nie zapisano: {message}",
    "ui.auth.missing": "Ta strona wymaga tokenu API w nagłówku X-Crek-Token. Wyślij go rozszerzeniem przeglądarki do nagłówków (np. ModHeader) — zob. crek-php/README.md.",
    "ui.auth.invalid": "Zły token.",
    "ui.auth.not_configured": "Aplikacja nie jest skonfigurowana: {problem}. Ustaw $api_token w config.php na 32 losowe bajty w zapisie szesnastkowym (openssl rand -hex 32) — aplikacja nie działa bez zabezpieczenia."
  }
}
JSON, true);
/** Translated, HTML-escaped UI string; {placeholders} filled from $vars. */
function t($key, array $vars = []) {
    global $CREK_DICT;
    $text = isset($CREK_DICT[$key]) ? $CREK_DICT[$key] : $key;
    foreach ($vars as $k => $v) $text = str_replace('{' . $k . '}', (string)$v, $text);
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

// ---------------------------------------------------------------- config.php, language, theme
require __DIR__ . '/crek-auth.php';
try {
    // Sets $api_token, the UI defaults ($ui_lang, $ui_theme), then opens the database.
    require __DIR__ . '/config.php';
} catch (Throwable $e) {
    // The page needs only the token and the UI defaults; api.php reports the database problem.
    error_log('crek index.php: config.php: ' . $e->getMessage());
}

/** The UI default language: $ui_lang from config.php (CREK_LANG, if a config defines it, too). */
function crek_ui_lang(array $dicts) {
    global $ui_lang;
    $code = isset($ui_lang) && is_string($ui_lang) ? $ui_lang : (defined('CREK_LANG') ? CREK_LANG : 'pl');
    $code = strtolower(trim($code));
    return isset($dicts[$code]) ? $code : 'en';
}
$CREK_HTML_LANG = crek_ui_lang($CREK_I18N);
$CREK_DICT = $CREK_I18N[$CREK_HTML_LANG] + $CREK_I18N['en'];
$CREK_THEME = (isset($ui_theme) && in_array($ui_theme, ['dark', 'light'], true)) ? $ui_theme : 'dark';

// ---------------------------------------------------------------- access (crek-auth.php)

/** The only answer without a valid X-Crek-Token header: one line of text, no data, no app code. */
function crek_refuse($code, $message) {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

$crekToken = crek_token($api_token ?? null);
if ($crekToken === '') {
    error_log('crek index.php: ' . crek_token_problem($api_token ?? null) . ' — the app is closed');
    crek_refuse(503, html_entity_decode(t('ui.auth.not_configured', ['problem' => crek_token_problem($api_token ?? null)]), ENT_QUOTES, 'UTF-8'));
}
$crekTokenState = crek_request_token($crekToken);
if ($crekTokenState !== 'ok') {
    crek_refuse(401, html_entity_decode(t($crekTokenState === 'missing' ? 'ui.auth.missing' : 'ui.auth.invalid'), ENT_QUOTES, 'UTF-8'));
}

/** The status vocabulary: the ui.status.* keys of the dictionary, in its order (as in api.php). */
function crek_status_keys() {
    global $CREK_I18N;
    $out = [];
    foreach (array_keys($CREK_I18N['en']) as $k) {
        if (strpos($k, 'ui.status.') === 0) $out[] = substr($k, strlen('ui.status.'));
    }
    return $out;
}

/** <option>s for the job statuses. Values are API vocabulary and never translated. */
function status_options() {
    $out = '';
    foreach (crek_status_keys() as $s) {
        $out .= '<option value="' . htmlspecialchars($s, ENT_QUOTES, 'UTF-8') . '">' . t('ui.status.' . $s) . '</option>';
    }
    return $out;
}

/** <option>s for the language switch: every language with a dictionary. */
function lang_options() {
    global $CREK_I18N, $CREK_HTML_LANG;
    $out = '';
    foreach (array_keys($CREK_I18N) as $code) {
        $c = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');
        $out .= '<option value="' . $c . '"' . ($code === $CREK_HTML_LANG ? ' selected' : '') . '>' . strtoupper($c) . '</option>';
    }
    return $out;
}
?>
<!DOCTYPE html>
<html lang="<?= $CREK_HTML_LANG ?>" data-theme="<?= $CREK_THEME ?>">
<head>
<meta charset="utf-8">
<script>
// The theme before the first paint: the browser's own choice (localStorage), else config.php's.
(function () {
    try {
        var saved = localStorage.getItem('crek.ui.theme');
        if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
    } catch (e) { /* storage blocked: keep the default */ }
})();
</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title data-i18n="ui.page_title"><?= t('ui.page_title') ?></title>
<style>
:root {
    color-scheme: dark; /* dark native scrollbars: the board's scrollbars stay visible but not glaring */
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #242734;
    --border: #2e3142;
    --text: #e2e4eb;
    --text2: #8b8fa3;
    --accent: #6c8cff;
    --accent2: #4a6adf;
    --green: #34d399;
    --yellow: #fbbf24;
    --orange: #fb923c;
    --red: #f87171;
    --purple: #a78bfa;
    --cyan: #22d3ee;
    --radius: 10px;
}
/* Light theme: the same variables, light values (data-theme on <html>, set from config.php or the switch). */
:root[data-theme="light"] {
    color-scheme: light;
    --bg: #f4f5f9;
    --surface: #ffffff;
    --surface2: #eceef4;
    --border: #d5d8e2;
    --text: #1c2030;
    --text2: #5b6074;
    --accent: #3d5bd9;
    --accent2: #2c47b8;
    --green: #0b8a5f;
    --yellow: #a86a00;
    --orange: #c0510a;
    --red: #cc3333;
    --purple: #6d4fd1;
    --cyan: #0a7f96;
}
* { margin:0; padding:0; box-sizing:border-box; }
/* The page itself never scrolls: header, stats and filters stay put, the active view fills the rest
   of the viewport and scrolls inside itself, so its scrollbars are always on screen. */
html, body { height:100%; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background:var(--bg); color:var(--text); height:100vh; overflow:hidden; display:flex; flex-direction:column; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }

.header { flex:none; background:var(--surface); border-bottom:1px solid var(--border); padding:8px 20px; display:flex; align-items:center; gap:24px; flex-wrap:wrap; z-index:100; }
.brand { display:flex; flex-direction:column; line-height:1.1; }
.header h1 { font-size:20px; font-weight:700; letter-spacing:1px; }
.header h1 span { color:var(--accent); }
.brand .plugin-link { font-size:11px; color:var(--text2); margin-top:2px; }
.brand .plugin-link:hover { color:var(--accent); }
.header-actions { display:flex; gap:10px; margin-left:auto; align-items:center; }
.ui-switches { display:flex; gap:6px; align-items:center; }
.ui-switches select { background:var(--bg); border:1px solid var(--border); color:var(--text); padding:6px 8px; border-radius:6px; font-size:13px; font-family:inherit; }

/* Full width; a flex column so the active view takes whatever height is left. */
.container { flex:1; min-height:0; display:flex; flex-direction:column; padding:16px 20px; }

/* Tabs */
.tabs { display:flex; gap:4px; background:var(--bg); padding:4px; border-radius:var(--radius); width:fit-content; }
.tab { padding:8px 20px; border-radius:8px; cursor:pointer; font-size:14px; color:var(--text2); border:none; background:none; transition:all .2s; }
.tab:hover { color:var(--text); }
.tab.active { background:var(--accent); color:#fff; }

/* Stats */
.stats { flex:none; display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom:16px; }
.stat-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; }
.stat-card .label { font-size:12px; color:var(--text2); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
.stat-card .value { font-size:28px; font-weight:700; }
.stat-card .value.green { color:var(--green); }
.stat-card .value.yellow { color:var(--yellow); }
.stat-card .value.accent { color:var(--accent); }
.stat-card .value.purple { color:var(--purple); }
.stat-card .value.orange { color:var(--orange); }

/* Kanban */
/* Columns fill the board height and scroll their own cards; the board scrolls sideways,
   with its scrollbar at the bottom of the viewport. */
.kanban { flex:1; min-height:0; display:flex; gap:12px; overflow-x:auto; overflow-y:hidden; padding-bottom:8px; }
.kanban-col { min-width:260px; max-width:300px; flex:1; min-height:0; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); display:flex; flex-direction:column; }
.kanban-col-header { flex:none; padding:12px 16px; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
.kanban-col-header .count { background:var(--surface2); padding:2px 8px; border-radius:12px; font-size:12px; color:var(--text2); }
.kanban-cards { padding:8px; flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
.kanban-card { flex:none; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:12px; cursor:pointer; transition:border-color .2s; overflow-wrap:anywhere; /* long URLs/locations must not widen the column */ }
.kanban-card:hover { border-color:var(--accent); }
.kanban-card .card-title { font-size:14px; font-weight:600; margin-bottom:6px; }
.kanban-card .card-company { font-size:12px; color:var(--accent); margin-bottom:4px; }
.kanban-card .card-meta { font-size:11px; color:var(--text2); display:flex; gap:8px; flex-wrap:wrap; }
.kanban-card .card-meta .tag { background:var(--bg); padding:2px 6px; border-radius:4px; }
.kanban-card .card-salary { font-size:12px; color:var(--green); margin-top:4px; font-weight:500; }
.kanban-card .card-score { position:relative; display:inline-block; font-size:11px; padding:2px 6px; border-radius:4px; font-weight:600; }

/* Status colors */
.status-new { border-left:3px solid var(--accent); }
.status-applied { border-left:3px solid var(--yellow); }
.status-interview { border-left:3px solid var(--orange); }
.status-offer { border-left:3px solid var(--green); }
.status-rejected { border-left:3px solid var(--red); }
.status-declined { border-left:3px solid var(--text2); }
/* skipped = set aside without review, no decision: dashed and dimmed, unlike declined */
.status-skipped { border-left:3px dashed var(--cyan); opacity:.75; }
/* closed = the employer stopped taking applications: nobody's no, greyed out */
.status-closed { border-left:3px dotted var(--text2); opacity:.6; }
.status-duplicate { border-left:3px solid var(--purple); }

/* Table */
.table-wrap { flex:1; min-height:0; overflow:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; padding:10px 12px; background:var(--surface); color:var(--text2); font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:1px; border-bottom:1px solid var(--border); position:sticky; top:0; z-index:1; }
td { padding:10px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
tr:hover td { background:var(--surface); }
.truncate { max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Toolbar */
.toolbar { flex:none; display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
.toolbar input, .toolbar select { background:var(--surface); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:8px; font-size:14px; }
.toolbar input:focus, .toolbar select:focus { outline:none; border-color:var(--accent); }
.toolbar input[type=search] { min-width:250px; }

/* Buttons */
.btn { padding:8px 16px; border-radius:8px; border:none; cursor:pointer; font-size:14px; font-weight:500; transition:all .2s; }
.btn-primary { background:var(--accent); color:#fff; }
.btn-primary:hover { background:var(--accent2); }
.btn-danger { background:var(--red); color:#fff; }
.btn-danger:hover { opacity:.8; }
.btn-ghost { background:none; color:var(--text2); border:1px solid var(--border); }
.btn-ghost:hover { border-color:var(--text2); color:var(--text); }
.btn-sm { padding:4px 10px; font-size:12px; }

/* Modal */
.modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:200; align-items:flex-start; justify-content:center; padding:40px 20px; overflow-y:auto; }
.modal-overlay.open { display:flex; }
.modal { background:var(--surface); border:1px solid var(--border); border-radius:12px; width:100%; max-width:700px; }
.modal-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
.modal-header h2 { font-size:18px; }
.modal-close { background:none; border:none; color:var(--text2); font-size:24px; cursor:pointer; padding:4px 8px; }
.modal-close:hover { color:var(--text); }
.modal-body { padding:20px; max-height:70vh; overflow-y:auto; }
.modal-footer { padding:16px 20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:10px; }

/* Form */
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.form-group { display:flex; flex-direction:column; gap:4px; }
.form-group.full { grid-column:1/-1; }
.form-group label { font-size:12px; color:var(--text2); text-transform:uppercase; letter-spacing:.5px; }
.form-group input, .form-group select, .form-group textarea { background:var(--bg); border:1px solid var(--border); color:var(--text); padding:8px 10px; border-radius:6px; font-size:14px; font-family:inherit; }
.form-group textarea { resize:vertical; min-height:80px; }
.form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline:none; border-color:var(--accent); }

/* Contacts page */
.contact-grid { flex:1; min-height:0; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(300px,1fr)); align-content:start; gap:12px; }
.contact-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; }
.contact-card h3 { font-size:15px; margin-bottom:4px; }
.contact-card .company { color:var(--accent); font-size:13px; margin-bottom:8px; }
.contact-card .detail { font-size:12px; color:var(--text2); margin-bottom:2px; }
.contact-card .job-count { font-size:11px; color:var(--text2); margin-top:8px; padding-top:8px; border-top:1px solid var(--border); }
.contact-actions { margin-top:8px; display:flex; gap:6px; }

/* View modal */
.detail-section { margin-bottom:16px; }
.detail-section h3 { font-size:13px; color:var(--text2); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
.detail-row { display:flex; gap:12px; margin-bottom:6px; font-size:14px; }
.detail-row .dl { color:var(--text2); min-width:130px; }
.detail-row .dv { flex:1; }
.detail-row .dv a { word-break:break-all; }
.tech-tags { display:flex; flex-wrap:wrap; gap:4px; }
.tech-tag { background:var(--accent); color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; }
pre.comm { white-space:pre-wrap; font-family:inherit; font-size:13px; color:var(--text); background:var(--bg); padding:10px; border-radius:6px; max-height:200px; overflow-y:auto; }
</style>
</head>
<body>

<div class="header">
    <div class="brand">
        <h1><span>C</span>REK</h1>
        <a class="plugin-link" href="https://github.com/claudeholic/claudeholic-plugins/tree/master/plugins/crek" target="_blank" rel="noopener">crek plugin</a>
    </div>
    <div class="tabs">
        <button class="tab active" data-tab="kanban" data-i18n="ui.tab.kanban"><?= t('ui.tab.kanban') ?></button>
        <button class="tab" data-tab="table" data-i18n="ui.tab.table"><?= t('ui.tab.table') ?></button>
        <button class="tab" data-tab="contacts" data-i18n="ui.tab.contacts"><?= t('ui.tab.contacts') ?></button>
    </div>
    <div class="header-actions">
        <button class="btn btn-primary" onclick="openJobModal()" data-i18n="ui.add_job"><?= t('ui.add_job') ?></button>
        <button class="btn btn-ghost" onclick="openContactModal()" data-i18n="ui.add_contact"><?= t('ui.add_contact') ?></button>
        <div class="ui-switches">
            <select id="uiLang" title="<?= t('ui.lang.label') ?>" aria-label="<?= t('ui.lang.label') ?>" data-i18n-title="ui.lang.label"><?= lang_options() ?></select>
            <select id="uiTheme" title="<?= t('ui.theme.label') ?>" aria-label="<?= t('ui.theme.label') ?>" data-i18n-title="ui.theme.label">
                <option value="dark"<?= $CREK_THEME === 'dark' ? ' selected' : '' ?>><?= t('ui.theme.dark') ?></option>
                <option value="light"<?= $CREK_THEME === 'light' ? ' selected' : '' ?>><?= t('ui.theme.light') ?></option>
            </select>
        </div>
    </div>
</div>

<div class="container">
    <div id="stats" class="stats"></div>

    <div class="toolbar">
        <input type="search" id="search" placeholder="<?= t('ui.search_placeholder') ?>" data-i18n-placeholder="ui.search_placeholder">
        <select id="filterStatus">
            <option value="all" data-i18n="ui.filter.all_statuses"><?= t('ui.filter.all_statuses') ?></option>
            <?= status_options() ?>
        </select>
    </div>

    <div id="view-kanban" class="kanban"></div>

    <div id="view-table" class="table-wrap" style="display:none">
        <table>
            <thead><tr>
                <th data-i18n="ui.col.title"><?= t('ui.col.title') ?></th><th data-i18n="ui.col.company"><?= t('ui.col.company') ?></th><th data-i18n="ui.col.agency"><?= t('ui.col.agency') ?></th><th data-i18n="ui.col.source"><?= t('ui.col.source') ?></th>
                <th data-i18n="ui.col.rate"><?= t('ui.col.rate') ?></th><th data-i18n="ui.col.mode"><?= t('ui.col.mode') ?></th><th data-i18n="ui.col.score"><?= t('ui.col.score') ?></th><th data-i18n="ui.col.status"><?= t('ui.col.status') ?></th><th data-i18n="ui.col.date"><?= t('ui.col.date') ?></th><th></th>
            </tr></thead>
            <tbody id="table-body"></tbody>
        </table>
    </div>

    <div id="view-contacts" class="contact-grid" style="display:none"></div>
</div>

<!-- Job modal -->
<div class="modal-overlay" id="jobModal">
    <div class="modal">
        <div class="modal-header">
            <h2 id="jobModalTitle"><?= t('ui.job.new') ?></h2>
            <button class="modal-close" onclick="closeModal('jobModal')">&times;</button>
        </div>
        <div class="modal-body">
            <form id="jobForm" class="form-grid">
                <input type="hidden" id="job_id">
                <div class="form-group full"><label data-i18n="ui.field.title"><?= t('ui.field.title') ?></label><input id="f_title" required></div>
                <div class="form-group"><label data-i18n="ui.field.hiring_company"><?= t('ui.field.hiring_company') ?></label><input id="f_hiring_company"></div>
                <div class="form-group"><label data-i18n="ui.field.agency"><?= t('ui.field.agency') ?></label><input id="f_agency"></div>
                <div class="form-group"><label data-i18n="ui.field.source"><?= t('ui.field.source') ?></label>
                    <input id="f_source" list="dl_source" autocomplete="off">
                </div>
                <div class="form-group"><label data-i18n="ui.field.source_url"><?= t('ui.field.source_url') ?></label><input id="f_source_url" type="url"></div>
                <div class="form-group full"><label data-i18n="ui.field.apply_url"><?= t('ui.field.apply_url') ?></label><input id="f_apply_url" type="url"></div>
                <div class="form-group"><label data-i18n="ui.field.location"><?= t('ui.field.location') ?></label><input id="f_location"></div>
                <div class="form-group"><label data-i18n="ui.field.work_mode"><?= t('ui.field.work_mode') ?></label>
                    <input id="f_work_mode" list="dl_work_mode" autocomplete="off">
                </div>
                <div class="form-group"><label data-i18n="ui.field.seniority"><?= t('ui.field.seniority') ?></label>
                    <input id="f_seniority" list="dl_seniority" autocomplete="off">
                </div>
                <div class="form-group"><label data-i18n="ui.field.currency"><?= t('ui.field.currency') ?></label>
                    <input id="f_salary_currency" list="dl_currency" autocomplete="off">
                </div>
                <div class="form-group"><label data-i18n="ui.field.rate_hour_min"><?= t('ui.field.rate_hour_min') ?></label><input id="f_salary_min_hour" type="number"></div>
                <div class="form-group"><label data-i18n="ui.field.rate_hour_max"><?= t('ui.field.rate_hour_max') ?></label><input id="f_salary_max_hour" type="number"></div>
                <div class="form-group"><label data-i18n="ui.field.rate_month_min"><?= t('ui.field.rate_month_min') ?></label><input id="f_salary_min_month" type="number"></div>
                <div class="form-group"><label data-i18n="ui.field.rate_month_max"><?= t('ui.field.rate_month_max') ?></label><input id="f_salary_max_month" type="number"></div>
                <div class="form-group full"><label data-i18n="ui.field.technologies"><?= t('ui.field.technologies') ?></label><input id="f_technologies"></div>
                <div class="form-group"><label data-i18n="ui.field.match_score"><?= t('ui.field.match_score') ?></label><input id="f_match_score" type="number" min="1" max="10" step="1"></div>
                <div class="form-group"><label data-i18n="ui.field.cv_dir"><?= t('ui.field.cv_dir') ?></label><input id="f_cv_dir" placeholder="<?= t('ui.field.cv_dir_placeholder') ?>" data-i18n-placeholder="ui.field.cv_dir_placeholder"></div>
                <div class="form-group"><label data-i18n="ui.field.status"><?= t('ui.field.status') ?></label>
                    <select id="f_status"><?= status_options() ?></select>
                </div>
                <div class="form-group"><label data-i18n="ui.field.applied_date"><?= t('ui.field.applied_date') ?></label><input id="f_applied_date" type="date"></div>
                <div class="form-group"><label data-i18n="ui.field.response_date"><?= t('ui.field.response_date') ?></label><input id="f_response_date" type="date"></div>
                <div class="form-group"><label data-i18n="ui.field.my_rate_min"><?= t('ui.field.my_rate_min') ?></label><input id="f_my_rate_min" type="number"></div>
                <div class="form-group"><label data-i18n="ui.field.my_rate_max"><?= t('ui.field.my_rate_max') ?></label><input id="f_my_rate_max" type="number"></div>
                <div class="form-group"><label data-i18n="ui.field.my_rate_unit"><?= t('ui.field.my_rate_unit') ?></label>
                    <input id="f_my_rate_unit" list="dl_rate_unit" autocomplete="off">
                </div>
                <div class="form-group"><label data-i18n="ui.field.my_rate_currency"><?= t('ui.field.my_rate_currency') ?></label>
                    <input id="f_my_rate_currency" list="dl_currency" autocomplete="off">
                </div>
                <div class="form-group full"><label data-i18n="ui.field.description"><?= t('ui.field.description') ?></label><textarea id="f_description" rows="4"></textarea></div>
                <div class="form-group full"><label data-i18n="ui.field.communication"><?= t('ui.field.communication') ?></label><textarea id="f_communication" rows="3" placeholder="<?= t('ui.field.communication_placeholder') ?>" data-i18n-placeholder="ui.field.communication_placeholder"></textarea></div>
                <div class="form-group full"><label data-i18n="ui.field.meetings"><?= t('ui.field.meetings') ?></label><textarea id="f_meetings" rows="2" placeholder="<?= t('ui.field.meetings_placeholder') ?>" data-i18n-placeholder="ui.field.meetings_placeholder"></textarea></div>
                <div class="form-group full"><label data-i18n="ui.field.notes"><?= t('ui.field.notes') ?></label><textarea id="f_notes" rows="2"></textarea></div>
            </form>
            <!-- Suggestions, not a closed list: a value the pipeline already holds (a board, a
                 currency, a mode with nuance) stays as it is when the posting is edited. -->
            <datalist id="dl_source"></datalist>
            <datalist id="dl_work_mode"><option value="remote"><option value="hybrid"><option value="onsite"></datalist>
            <datalist id="dl_seniority"><option value="junior"><option value="mid"><option value="senior"><option value="lead"><option value="principal"></datalist>
            <datalist id="dl_currency"><option value="PLN"><option value="EUR"><option value="USD"><option value="GBP"><option value="CHF"></datalist>
            <datalist id="dl_rate_unit"><option value="hour" data-i18n="ui.unit.hour"><?= t('ui.unit.hour') ?></option><option value="day" data-i18n="ui.unit.day"><?= t('ui.unit.day') ?></option><option value="month" data-i18n="ui.unit.month"><?= t('ui.unit.month') ?></option></datalist>
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeModal('jobModal')" data-i18n="ui.btn.cancel"><?= t('ui.btn.cancel') ?></button>
            <button class="btn btn-primary" onclick="saveJob()" data-i18n="ui.btn.save"><?= t('ui.btn.save') ?></button>
        </div>
    </div>
</div>

<!-- Contact modal -->
<div class="modal-overlay" id="contactModal">
    <div class="modal" style="max-width:500px">
        <div class="modal-header">
            <h2 id="contactModalTitle"><?= t('ui.contact.new') ?></h2>
            <button class="modal-close" onclick="closeModal('contactModal')">&times;</button>
        </div>
        <div class="modal-body">
            <form id="contactForm" class="form-grid">
                <input type="hidden" id="c_id">
                <div class="form-group full"><label data-i18n="ui.contact.name"><?= t('ui.contact.name') ?></label><input id="c_name" required></div>
                <div class="form-group full"><label data-i18n="ui.contact.company"><?= t('ui.contact.company') ?></label><input id="c_company_name" required></div>
                <div class="form-group"><label data-i18n="ui.contact.role"><?= t('ui.contact.role') ?></label><input id="c_role" placeholder="<?= t('ui.contact.role_placeholder') ?>" data-i18n-placeholder="ui.contact.role_placeholder"></div>
                <div class="form-group"><label data-i18n="ui.contact.phone"><?= t('ui.contact.phone') ?></label><input id="c_phone"></div>
                <div class="form-group full"><label data-i18n="ui.contact.email"><?= t('ui.contact.email') ?></label><input id="c_email" type="email"></div>
                <div class="form-group full"><label data-i18n="ui.contact.linkedin"><?= t('ui.contact.linkedin') ?></label><input id="c_linkedin_url" type="url"></div>
                <div class="form-group full"><label data-i18n="ui.contact.notes"><?= t('ui.contact.notes') ?></label><textarea id="c_notes" rows="2"></textarea></div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeModal('contactModal')" data-i18n="ui.btn.cancel"><?= t('ui.btn.cancel') ?></button>
            <button class="btn btn-primary" onclick="saveContact()" data-i18n="ui.btn.save"><?= t('ui.btn.save') ?></button>
        </div>
    </div>
</div>

<!-- View job modal -->
<div class="modal-overlay" id="viewModal">
    <div class="modal" style="max-width:750px">
        <div class="modal-header">
            <h2 id="viewTitle"></h2>
            <button class="modal-close" onclick="closeModal('viewModal')">&times;</button>
        </div>
        <div class="modal-body" id="viewBody"></div>
        <div class="modal-footer">
            <button class="btn btn-danger btn-sm" id="viewDeleteBtn" data-i18n="ui.btn.delete"><?= t('ui.btn.delete') ?></button>
            <button class="btn btn-ghost" onclick="closeModal('viewModal')" data-i18n="ui.btn.close"><?= t('ui.btn.close') ?></button>
            <button class="btn btn-primary" id="viewEditBtn" data-i18n="ui.btn.edit"><?= t('ui.btn.edit') ?></button>
        </div>
    </div>
</div>

<script>
// Relative, so the app works in any directory, not only at the root of a domain.
const API_BASE = 'api.php?route=';
let jobs = [], contacts = [], currentTab = 'kanban', knownSources = [];
const DEFAULT_SOURCES = ['LinkedIn', 'justjoin.it', 'nofluffjobs.com', 'pracuj.pl', 'theprotocol.it', 'bulldogjob.pl'];

function fillDatalist(id, values) {
    const seen = new Set();
    document.getElementById(id).innerHTML = values
        .filter(v => v && !seen.has(String(v).toLowerCase()) && seen.add(String(v).toLowerCase()))
        .map(v => '<option value="' + esc(v) + '">').join('');
}

// UI strings: the ui.* part of every dictionary above. The language starts as config.php's
// $ui_lang and follows the switch in the header; the choice is kept in localStorage.
const I18N_ALL = <?= json_encode(array_map(function ($d) {
    return array_filter($d, function ($k) { return strpos($k, 'ui.') === 0; }, ARRAY_FILTER_USE_KEY);
}, $CREK_I18N), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
const UI_DEFAULT_LANG = <?= json_encode($CREK_HTML_LANG) ?>;
const UI_DEFAULT_THEME = <?= json_encode($CREK_THEME) ?>;
const uiStore = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: this page only */ } }
};
let uiLang = I18N_ALL[uiStore.get('crek.ui.lang')] ? uiStore.get('crek.ui.lang') : UI_DEFAULT_LANG;
let I18N = Object.assign({}, I18N_ALL.en, I18N_ALL[uiLang]);
function t(key, vars = {}) {
    const text = I18N[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Statuses: the ui.status.* keys of the dictionary (the same list api.php accepts), labels in the
// current language. Colours are presentation only; a status without one gets the muted colour.
const STATUS_KEYS = Object.keys(I18N_ALL.en).filter(k => k.startsWith('ui.status.')).map(k => k.slice('ui.status.'.length));
const STATUS_COLORS = {new:'var(--accent)', applied:'var(--yellow)', interview:'var(--orange)', offer:'var(--green)',
    rejected:'var(--red)', declined:'var(--text2)', skipped:'var(--cyan)', closed:'var(--text2)', duplicate:'var(--purple)'};
function statuses() {
    return STATUS_KEYS.map(key => ({key, label: t('ui.status.' + key), color: STATUS_COLORS[key] || 'var(--text2)'}));
}
function statusLabel(key) { return STATUS_KEYS.includes(key) ? t('ui.status.' + key) : (key || ''); }

/** Rebuild a status <select>, keeping its value; `all` adds the "all statuses" option first. */
function fillStatusSelect(id, all) {
    const el = document.getElementById(id);
    const value = el.value;
    el.innerHTML = (all ? '<option value="all">' + esc(t('ui.filter.all_statuses')) + '</option>' : '')
        + statuses().map(s => '<option value="' + esc(s.key) + '">' + esc(s.label) + '</option>').join('');
    if ([...el.options].some(o => o.value === value)) el.value = value;
}

/** Every fixed text of the page in the current language (data-i18n*), then the views. */
function applyLanguage() {
    I18N = Object.assign({}, I18N_ALL.en, I18N_ALL[uiLang]);
    document.documentElement.lang = uiLang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
    document.querySelectorAll('#uiTheme option').forEach(o => { o.textContent = t('ui.theme.' + o.value); });
    fillStatusSelect('filterStatus', true);
    fillStatusSelect('f_status', false);
}

function setTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') theme = UI_DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('uiTheme').value = theme;
}

// Every call either returns the parsed JSON or throws an Error whose message the user can read.
// The X-Crek-Token header is added by the browser's header extension to every request to this
// site, fetch() included — nothing to add here, and the token is never in the page.
async function api(route, method='GET', body=null) {
    const opts = {method, headers:{'Accept':'application/json'}, credentials:'include'};
    if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(API_BASE + route, opts); }
    catch (e) { throw new Error(e.message || 'network error'); }
    let data = null;
    try { data = await r.json(); } catch (e) { /* not JSON: reported below */ }
    if (!r.ok || data === null) {
        throw new Error((data && data.error) ? data.error + ' (HTTP ' + r.status + ')' : 'HTTP ' + r.status);
    }
    return data;
}

function showError(key, err) {
    alert(t(key, {message: err && err.message ? err.message : String(err)}));
}

function formatSalary(j) {
    const parts = [];
    if (j.salary_min_hour || j.salary_max_hour) {
        const min = esc(j.salary_min_hour || '?'), max = esc(j.salary_max_hour || '?');
        parts.push(`${min}-${max}/h`);
    }
    if (j.salary_min_month || j.salary_max_month) {
        const min = esc(j.salary_min_month || '?'), max = esc(j.salary_max_month || '?');
        parts.push(`${min}-${max}${esc(t('ui.per_month'))}`);
    }
    if (!parts.length) return '';
    return parts.join(' | ') + ' ' + esc(j.salary_currency || 'PLN');
}

// match_score is the crek 1-10 score. A few early rows were stored on a 0-100 scale; they are shown
// as "/100" (the data is left as it is) and coloured on the equivalent 1-10 value.
function scoreValue(s) { const n = Number(s); return n > 10 ? n / 10 : n; }
function fmtScore(s) { return esc(Number(s) > 10 ? s + '/100' : s + '/10'); }
function scoreColor(s) {
    if (!s && s !== 0) return '';
    const n = scoreValue(s);
    if (n >= 8) return 'background:rgba(52,211,153,.2);color:var(--green)';
    if (n >= 5) return 'background:rgba(251,191,36,.2);color:var(--yellow)';
    return 'background:rgba(248,113,113,.2);color:var(--red)';
}

async function loadAll() {
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('search').value;
    let url = 'jobs';
    const params = [];
    if (status !== 'all') params.push('status=' + encodeURIComponent(status));
    if (search) params.push('search=' + encodeURIComponent(search));
    if (params.length) url += '&' + params.join('&');
    try {
        [jobs, contacts] = await Promise.all([api(url), api('contacts')]);
    } catch (e) { showError('ui.error.api', e); return; }
    render();
    loadStats();
}

let lastStats = null;
async function loadStats() {
    try { lastStats = await api('stats'); } catch (e) { showError('ui.error.api', e); return; }
    renderStats();
}

function renderStats() {
    const s = lastStats;
    if (!s) return;
    const statusMap = {};
    (s.by_status || []).forEach(r => statusMap[r.status] = parseInt(r.count));
    knownSources = (s.by_source || []).map(r => r.source).filter(Boolean);
    fillDatalist('dl_source', [...knownSources, ...DEFAULT_SOURCES]);
    document.getElementById('stats').innerHTML = `
        <div class="stat-card"><div class="label">${t('ui.stats.postings')}</div><div class="value accent">${num(s.total)}</div></div>
        <div class="stat-card"><div class="label">${t('ui.stats.applied')}</div><div class="value yellow">${num(statusMap.applied)}</div></div>
        <div class="stat-card"><div class="label">${t('ui.stats.interviews')}</div><div class="value orange">${num(statusMap.interview)}</div></div>
        <div class="stat-card"><div class="label">${t('ui.stats.offers')}</div><div class="value green">${num(statusMap.offer)}</div></div>
        <div class="stat-card"><div class="label">${t('ui.stats.avg_match')}</div><div class="value purple">${s.avg_match ? Number(s.avg_match).toFixed(1) + '/10' : '—'}</div></div>
        <div class="stat-card"><div class="label">${t('ui.stats.contacts')}</div><div class="value accent">${num(s.contacts_count)}</div></div>
    `;
}

function render() {
    if (currentTab === 'kanban') renderKanban();
    else if (currentTab === 'table') renderTable();
    else renderContacts();
}

function renderKanban() {
    const kb = document.getElementById('view-kanban');
    kb.innerHTML = statuses().map(st => {
        const filtered = jobs.filter(j => (j.status || 'new') === st.key);
        return `<div class="kanban-col">
            <div class="kanban-col-header" style="border-top:3px solid ${st.color}">
                ${esc(st.label)} <span class="count">${filtered.length}</span>
            </div>
            <div class="kanban-cards">${filtered.map(j => `
                <div class="kanban-card status-${esc(j.status || 'new')}" onclick="viewJob(${num(j.id)})">
                    <div class="card-title">${esc(j.title)}</div>
                    <div class="card-company">${esc(j.hiring_company || '')}${j.agency ? ' <span style="color:var(--text2)">' + t('ui.via') + ' ' + esc(j.agency) + '</span>' : ''}</div>
                    ${formatSalary(j) ? '<div class="card-salary">' + formatSalary(j) + '</div>' : ''}
                    <div class="card-meta">
                        ${j.work_mode ? '<span class="tag">' + esc(j.work_mode) + '</span>' : ''}
                        ${j.source ? '<span class="tag">' + esc(j.source) + '</span>' : ''}
                        ${j.match_score ? '<span class="card-score" style="' + scoreColor(j.match_score) + '">' + fmtScore(j.match_score) + '</span>' : ''}
                    </div>
                </div>`).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderTable() {
    document.getElementById('table-body').innerHTML = jobs.map(j => `<tr onclick="viewJob(${num(j.id)})" style="cursor:pointer">
        <td><strong>${esc(j.title)}</strong></td>
        <td>${esc(j.hiring_company || '')}</td>
        <td>${esc(j.agency || '')}</td>
        <td>${esc(j.source || '')}</td>
        <td style="color:var(--green);white-space:nowrap">${formatSalary(j)}</td>
        <td>${esc(j.work_mode || '')}</td>
        <td>${j.match_score ? '<span style="' + scoreColor(j.match_score) + ';padding:2px 6px;border-radius:4px">' + fmtScore(j.match_score) + '</span>' : ''}</td>
        <td>${esc(statusLabel(j.status))}</td>
        <td style="white-space:nowrap;color:var(--text2)">${j.found_at ? esc(String(j.found_at).substring(0,10)) : ''}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editJob(${num(j.id)})">${t('ui.btn.edit')}</button></td>
    </tr>`).join('');
}

function renderContacts() {
    document.getElementById('view-contacts').innerHTML = contacts.map(c => `
        <div class="contact-card">
            <h3>${esc(c.name)}</h3>
            <div class="company">${esc(c.company_name)}${c.role ? ' — ' + esc(c.role) : ''}</div>
            ${c.email ? '<div class="detail">' + esc(c.email) + '</div>' : ''}
            ${c.phone ? '<div class="detail">' + esc(c.phone) + '</div>' : ''}
            ${c.linkedin_url ? '<div class="detail">' + link(c.linkedin_url, 'LinkedIn') + '</div>' : ''}
            ${c.notes ? '<div class="detail" style="margin-top:6px;color:var(--text)">' + esc(c.notes) + '</div>' : ''}
            <div class="job-count">${t('ui.contact.job_count', {n: num(c.job_count)})}</div>
            <div class="contact-actions">
                <button class="btn btn-ghost btn-sm" onclick="editContact(${num(c.id)})">${t('ui.btn.edit')}</button>
                <button class="btn btn-danger btn-sm" onclick="deleteContact(${num(c.id)})">${t('ui.btn.delete')}</button>
            </div>
        </div>`).join('') || '<p style="color:var(--text2)">' + t('ui.contact.none') + '</p>';
}

function viewJob(id) {
    const j = jobs.find(x => x.id == id);
    if (!j) return;
    document.getElementById('viewTitle').textContent = j.title;
    let techs = '';
    try { const t = JSON.parse(j.technologies || '[]'); techs = t.map(x => `<span class="tech-tag">${esc(x)}</span>`).join(''); } catch(e) { techs = esc(j.technologies || ''); }

    document.getElementById('viewBody').innerHTML = `
        <div class="detail-section">
            <div class="detail-row"><span class="dl">${t('ui.view.company')}:</span><span class="dv">${esc(j.hiring_company || '—')}</span></div>
            ${j.agency ? '<div class="detail-row"><span class="dl">' + t('ui.view.agency') + ':</span><span class="dv">' + esc(j.agency) + '</span></div>' : ''}
            <div class="detail-row"><span class="dl">${t('ui.view.source')}:</span><span class="dv">${esc(j.source || '—')}${j.source_url ? ' — ' + link(j.source_url, t('ui.view.link')) : ''}</span></div>
            ${j.apply_url ? '<div class="detail-row"><span class="dl">' + t('ui.view.form') + ':</span><span class="dv">' + link(j.apply_url, t('ui.view.link')) + '</span></div>' : ''}
            <div class="detail-row"><span class="dl">${t('ui.view.location')}:</span><span class="dv">${esc(j.location || '—')} ${j.work_mode ? '(' + esc(j.work_mode) + ')' : ''}</span></div>
            <div class="detail-row"><span class="dl">${t('ui.view.seniority')}:</span><span class="dv">${esc(j.seniority || '—')}</span></div>
            ${formatSalary(j) ? '<div class="detail-row"><span class="dl">' + t('ui.view.rate') + ':</span><span class="dv" style="color:var(--green)">' + formatSalary(j) + '</span></div>' : ''}
            ${j.my_rate_min ? '<div class="detail-row"><span class="dl">' + t('ui.view.my_rate') + ':</span><span class="dv">' + esc(j.my_rate_min + (j.my_rate_max ? '-' + j.my_rate_max : '') + '/' + (j.my_rate_unit || '?') + ' ' + (j.my_rate_currency || '')) + '</span></div>' : ''}
            ${j.match_score ? '<div class="detail-row"><span class="dl">' + t('ui.view.match') + ':</span><span class="dv"><span style="' + scoreColor(j.match_score) + ';padding:2px 8px;border-radius:4px">' + fmtScore(j.match_score) + '</span></span></div>' : ''}
            ${j.cv_dir ? '<div class="detail-row"><span class="dl">' + t('ui.view.cv') + ':</span><span class="dv"><code>' + esc(j.cv_dir) + '</code></span></div>' : ''}
        </div>
        ${techs ? '<div class="detail-section"><h3>' + t('ui.view.technologies') + '</h3><div class="tech-tags">' + techs + '</div></div>' : ''}
        ${j.description ? '<div class="detail-section"><h3>' + t('ui.view.description') + '</h3><pre class="comm">' + esc(j.description) + '</pre></div>' : ''}
        ${j.communication ? '<div class="detail-section"><h3>' + t('ui.view.communication') + '</h3><pre class="comm">' + esc(j.communication) + '</pre></div>' : ''}
        ${j.meetings ? '<div class="detail-section"><h3>' + t('ui.view.meetings') + '</h3><pre class="comm">' + esc(j.meetings) + '</pre></div>' : ''}
        ${j.contact_names ? '<div class="detail-section"><h3>' + t('ui.view.contacts') + '</h3><div>' + String(j.contact_names).split('||').map(n => '<span class="tech-tag" style="background:var(--surface2)">' + esc(n) + '</span>').join(' ') + '</div></div>' : ''}
        ${j.notes ? '<div class="detail-section"><h3>' + t('ui.view.notes') + '</h3><pre class="comm">' + esc(j.notes) + '</pre></div>' : ''}
        <div class="detail-section" style="color:var(--text2);font-size:12px">
            ${t('ui.view.found')}: ${esc(j.found_at || '—')} | ${t('ui.view.applied')}: ${esc(j.applied_date || '—')} | ${t('ui.view.response')}: ${esc(j.response_date || '—')}
        </div>
    `;
    document.getElementById('viewEditBtn').onclick = () => { closeModal('viewModal'); editJob(id); };
    document.getElementById('viewDeleteBtn').onclick = async () => {
        if (!confirm(t('ui.job.delete_confirm'))) return;
        try { await api('jobs/' + num(id), 'DELETE'); } catch (e) { showError('ui.error.save', e); return; }
        closeModal('viewModal'); loadAll();
    };
    openModal('viewModal');
}

function openJobModal(data) {
    document.getElementById('jobModalTitle').textContent = data ? t('ui.job.edit') : t('ui.job.new');
    const fields = ['title','agency','hiring_company','source','source_url','apply_url','location','work_mode',
        'salary_min_hour','salary_max_hour','salary_min_month','salary_max_month','salary_currency','seniority',
        'technologies','description','match_score','cv_dir','status','applied_date','response_date',
        'my_rate_min','my_rate_max','my_rate_unit','my_rate_currency','notes','communication','meetings'];
    document.getElementById('job_id').value = data?.id || '';
    fields.forEach(f => {
        const el = document.getElementById('f_' + f);
        let val = data?.[f] || '';
        if (f === 'technologies' && val) { try { val = JSON.parse(val).join(', '); } catch(e){} }
        // A status the list does not know (added by a newer plugin, typed by hand) is kept, not
        // silently replaced by the first option on save.
        if (el && el.tagName === 'SELECT' && val && ![...el.options].some(o => o.value === String(val))) {
            const o = document.createElement('option'); o.value = val; o.textContent = val; el.appendChild(o);
        }
        if (el) el.value = val;
    });
    if (!data) document.getElementById('f_status').value = 'new';
    if (!data) document.getElementById('f_salary_currency').value = 'PLN';
    openModal('jobModal');
}

function editJob(id) { openJobModal(jobs.find(j => j.id == id)); }

async function saveJob() {
    const id = document.getElementById('job_id').value;
    const data = {};
    const fields = ['title','agency','hiring_company','source','source_url','apply_url','location','work_mode',
        'salary_min_hour','salary_max_hour','salary_min_month','salary_max_month','salary_currency','seniority',
        'technologies','description','match_score','cv_dir','status','applied_date','response_date',
        'my_rate_min','my_rate_max','my_rate_unit','my_rate_currency','notes','communication','meetings'];
    // Score must be a whole 1-10 value; an untouched legacy 0-100 value may be saved as it is.
    const scoreEl = document.getElementById('f_match_score');
    const oldScore = id ? String(jobs.find(j => j.id == id)?.match_score ?? '') : '';
    if (scoreEl.value !== oldScore && !scoreEl.checkValidity()) { scoreEl.reportValidity(); return; }
    fields.forEach(f => {
        let val = document.getElementById('f_' + f)?.value || '';
        if (f === 'technologies' && val) val = JSON.stringify(val.split(',').map(s => s.trim()).filter(Boolean));
        data[f] = val;
    });
    try {
        if (id) await api('jobs/' + num(id), 'PUT', data);
        else await api('jobs', 'POST', data);
    } catch (e) { showError('ui.error.save', e); return; }
    closeModal('jobModal');
    loadAll();
}

function openContactModal(data) {
    document.getElementById('contactModalTitle').textContent = data ? t('ui.contact.edit') : t('ui.contact.new');
    document.getElementById('c_id').value = data?.id || '';
    ['name','company_name','role','phone','email','linkedin_url','notes'].forEach(f => {
        document.getElementById('c_' + f).value = data?.[f] || '';
    });
    openModal('contactModal');
}

function editContact(id) { openContactModal(contacts.find(c => c.id == id)); }

async function saveContact() {
    const id = document.getElementById('c_id').value;
    const data = {};
    ['name','company_name','role','phone','email','linkedin_url','notes'].forEach(f => data[f] = document.getElementById('c_' + f).value);
    try {
        if (id) await api('contacts/' + num(id), 'PUT', data);
        else await api('contacts', 'POST', data);
    } catch (e) { showError('ui.error.save', e); return; }
    closeModal('contactModal');
    loadAll();
}

async function deleteContact(id) {
    if (!confirm(t('ui.contact.delete_confirm'))) return;
    try { await api('contacts/' + num(id), 'DELETE'); } catch (e) { showError('ui.error.save', e); return; }
    loadAll();
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// Everything from the database is text from job postings, i.e. from third parties: escape it all,
// quotes included (values also land in attributes), and let only http(s) links become hrefs.
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeUrl(u) { return /^https?:\/\//i.test(String(u ?? '').trim()) ? String(u).trim() : ''; }
function link(u, label) { const h = safeUrl(u); return h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : esc(u); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Tabs
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    currentTab = t.dataset.tab;
    document.getElementById('view-kanban').style.display = currentTab === 'kanban' ? 'flex' : 'none';
    document.getElementById('view-table').style.display = currentTab === 'table' ? '' : 'none';
    document.getElementById('view-contacts').style.display = currentTab === 'contacts' ? 'grid' : 'none';
    render();
}));

// Search & filter
let searchTimeout;
document.getElementById('search').addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(loadAll, 300); });
document.getElementById('filterStatus').addEventListener('change', loadAll);

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

// Language and theme switches: applied at once, remembered in this browser.
document.getElementById('uiLang').addEventListener('change', e => {
    uiLang = I18N_ALL[e.target.value] ? e.target.value : UI_DEFAULT_LANG;
    uiStore.set('crek.ui.lang', uiLang);
    applyLanguage();
    render();
    renderStats();
});
document.getElementById('uiTheme').addEventListener('change', e => {
    setTheme(e.target.value);
    uiStore.set('crek.ui.theme', e.target.value);
});

// Init
document.getElementById('uiLang').value = uiLang;
setTheme(document.documentElement.getAttribute('data-theme'));
if (uiLang !== UI_DEFAULT_LANG) applyLanguage();
loadAll();
</script>
</body>
</html>
