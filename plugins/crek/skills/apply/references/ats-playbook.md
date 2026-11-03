# ATS playbook — platform-specific traps and techniques

General rules first, then per-platform notes. All interaction goes through browser automation
(a11y snapshot → click/type by uid). Take a fresh snapshot after any action that re-renders;
stale uids fail. Job boards and ATSes commonly 403 plain HTTP clients — browse, don't curl.

## Universal rules

- **React-controlled inputs are the #1 trap.** Setting `el.value` via JS (even with the
  native-setter + `_valueTracker` trick) often leaves the framework state empty: the DOM shows
  your text, but submit says "field is required". Reliable order of escalation:
  1. click the field, then send real keystrokes (type-text tool);
  2. if values still vanish → trusted input via CDP `Input.insertText` after focusing;
  3. verify by re-reading values AND by submitting and checking for validation errors.
- **Verify after submit, always.** Look for explicit confirmation text ("Thank you",
  "successfully submitted"). No confirmation = not submitted.
- **Dropdown/combobox fields disguised as textboxes**: typed text disappears on blur — the
  field only accepts values picked from its list. Open it, snapshot the options, click one
  (or type-to-filter then ArrowDown+Enter).
- **Radio/checkbox state can silently reset** after network hiccups or re-renders — re-check
  just before submitting.
- **Anti-bot / invisible reCAPTCHA escalation** (working around a site's bot protection may
  breach its terms of service and can get the account blocked — README, *Risks*): if a submission
  is flagged as spam, retry once after a few minutes with slightly reworded free-text answers; if
  still blocked, switch to the fallback browser: **a second browser of the user's, on a separate
  profile**, driven via CDP (ask them to start it with `--remote-debugging-port` and
  `--user-data-dir=<a directory of its own>`; store the port in config
  `browser.cdp_fallback_port`). A browser the user starts by hand often passes score checks that
  the automated one fails — but be honest with the user: a fresh profile has no history, so a
  check may still reject it; that is the price of keeping their everyday profile closed (below).
  Connect a minimal CDP client (Node ≥22 has WebSocket built in):
  create tab via `PUT /json/new?url=...`, evaluate JS via `Runtime.evaluate`, type via
  `Input.insertText`, upload via `DOM.setFileInputFiles`.
  **Tell the user what the debugging port means before they open it:** while it is open, every
  program on the machine can drive that browser and read every site it is signed in to — mail,
  bank, everything. Ask them to start a **separate profile** for it
  (`--user-data-dir=<a directory of its own>`, signed in only where the application needs it),
  listening on localhost only (`--remote-debugging-address=127.0.0.1`, the default — never
  `0.0.0.0`), and to **close that browser as soon as the form is sent**. Never ask for the port
  on their everyday profile.
- **Email verification codes**: some ATSes (Greenhouse) email an N-character code before
  accepting the submission. Each submit attempt may issue a NEW code — always ask the user
  for the newest one. Code boxes are often one input per character.

## Ashby (jobs.ashbyhq.com)

- React everywhere. For multiline answers: click → select-all → type; plain fill loses state.
- Location combobox: type the city, options load async — pick from `[role=option]`.
- Has invisible reCAPTCHA; "flagged as possible spam" → escalate to user-browser CDP path.
- Company job boards on Ashby list ALL locations — check per-role location lists, they can
  differ from aggregator data.

## Greenhouse (job-boards.greenhouse.io, often embedded)

- Usually embedded on the company site as a CROSS-ORIGIN IFRAME (`grnhse_iframe`). For CDP:
  the iframe is a separate target (OOPIF) — find it in `GET /json` (type=iframe, greenhouse
  URL) and attach directly to its webSocketDebuggerUrl; then it behaves like a normal page.
- Direct `job-boards.greenhouse.io/<company>/jobs/<id>` may redirect back to the embed.
- react-select comboboxes: type to filter, then **ArrowDown + Enter**. Do NOT click
  `[role=option]` blindly — the phone country list uses the same role and may be the one
  that's open (you'll select Afghanistan). Selected value appears in `.select__single-value`,
  not in the input.
- Phone: intl-tel-input; type the full number with country prefix, or set the Country
  combobox first and use a bare local number.
- Resume upload: `input#resume[type=file]`; after upload the input node is replaced — verify
  by filename appearing in page text.
- Email verification code: fields `security-input-0..7`, one char each.
- EEO/self-identification sections are voluntary — safe to skip or "decline to self-identify"
  (ask the user for a standing preference).

## Traffit (<company>.traffit.com)

- Reached via aggregator Apply buttons (opens a new tab).
- Several required fields look like textboxes but are dropdowns (placeholder "Click to load
  the list"): availability, years of experience, language level. Typed text silently
  disappears — click the field, wait for the list, click an option, then verify the visible
  label. Multi-select technology checklists: click each known item; chips appear above the
  field. Select ONLY technologies the candidate genuinely knows.
- Success = redirect to `/public/form/thankyou/...`.

## Personio (<company>.jobs.personio.de)

- Friendliest of the bunch: plain HTML form at `<job-url>/apply`, standard click+type works,
  file upload straightforward, no captcha drama. Submit button disabled until required fields
  are filled — its enabling is a good pre-submit sanity check.

## eRecruiter (form.erecruiter.pl)

- Straightforward form; radio groups (availability) can deselect after connection blips —
  re-verify before submit. Success = `/thank-you` URL.

## Pracuj.pl

- Offers an "apply without login" path — use it. Browser only; aggressively 403s bots.

## LinkedIn

- **LinkedIn MCP is optional → the browser always works.** The recommended `linkedin-mcp` plugin
  (`/plugin install linkedin-mcp@claudeholic-plugins`; tools `mcp__plugin_linkedin-mcp_linkedin__*`,
  or `mcp__linkedin__*` from a manually configured server) is a shortcut for search, postings,
  profiles and messages. When it is not installed, or its tools lack a function you need
  (attaching a file to a direct message, Easy Apply steps, anything the tools don't expose), do
  not hand the task back: log into LinkedIn through the browser plugin (chrome-shared, the shared
  logged-in profile; log in there if the session is missing, credentials key `linkedin` in
  `crek.config.json`) and do it through the GUI in your own tab.
- **No LinkedIn API, no scripts against LinkedIn.** CREK calls no LinkedIn endpoint of its own
  (the internal web API included): without the MCP tools, LinkedIn is read and clicked through
  like a person would — one page at a time, with pauses, only the pages the task needs. A missing
  session is handled as above; on a CAPTCHA, a security check or a warning, stop and tell the user
  (never solve or click through it on your own). Whether a posting is still open: *LinkedIn* in
  the job-scan skill.
- Easy Apply: multi-step wizard, snapshot between steps.
- Sending a CV in a message thread: use the paperclip "attach file" button in the thread via
  the browser (the messaging UI accepts uploads); confirm the file bubble appears after send.
- InMail replies: reply INTO the same thread; watch out — recruiter outreach and your inbox
  thread may be two different conversations.

## Aggregator boards (justjoin.it, nofluffjobs, solid.jobs, ...)

- The listing URL is `source_url`; the Apply button usually leads to the real ATS in a new
  tab — record that as `apply_url`. One role often appears on several boards AND on the
  company site: dedupe before applying.
- justjoin.it: listing pages lazy-load — scroll loop to enumerate; salary sometimes only in
  the side panel; "Apply" may open an internal form OR an external ATS.
