# CV factory — one script per variant, HTML → PDF

## The pattern

Each CV variant is a self-contained Python script in its own directory under the CV directory
from config (`cv.dir`). The script holds all content as Python data structures (competence rows,
experience entries, earlier experience, certificates) and renders a single HTML file, which is
then printed to PDF.

### Naming — this matters more than it looks

**Directory: `<Company>_<job id>`** — e.g. `CV/AcmeCorp_37/`. The id ties the directory to the
pipeline row, so no date is needed. One directory = one application: script, photo, HTML and PDF
together. The PDF sitting there IS what was sent — no separate archive to keep in sync. If a
second CV ever goes to the same posting, add a letter: `AcmeCorp_37b`.

**File: always the same neutral name** — `<Firstname>_<Lastname>_CV.pdf`. Never encode the
variant in the filename (`..._CV_SRE.pdf`, `..._CV_Data_Engineer.pdf`). The filename is metadata the
employer sees in the attachment, and a tailored name tells them the CV was written for their
posting specifically. The directory carries that information; it never leaves the candidate's disk.

**The same applies to PDF metadata.** Chrome copies the HTML `<title>` into the document's Title
field, visible in file properties — so the template's title must be plain `<Firstname> <Lastname> - CV`,
not the tailored headline. Check it with `pdfinfo` if unsure.

Record the directory name in the pipeline row (`cv_dir` column), so it is always clear which CV
went where and it can be rebuilt from its script.

**A cover letter, when the form wants one as a file, lives in the same directory** — the folder is the
whole application, not just the CV. Same neutral naming for the same reason: `<Firstname>_<Lastname>_Cover_Letter.pdf`,
built by its own script beside `build_cv.py`, with a plain `<Firstname> <Lastname> - Cover Letter` title.
One `cv_dir` value still covers everything that went out.

Watch the field label, not the field name. A textarea called `coverLetter` in the page source may be
labelled "How did you hear about this job?" on screen — fill in what the label says, not what the name
suggests.

### Rendering

Print through the browser that chrome-shared already keeps running — no second Chrome, no
dependency on what the binary happens to be called on this distribution:

```bash
python3 build_cv.py && node "${CLAUDE_PLUGIN_ROOT}/assets/html-to-pdf.mjs" <generated>.html
```

The output path defaults to the input with `.pdf`; pass a second argument to override, and
`--port N` if the browser listens somewhere unusual (the script tries `CS_CHROME_PORT`, 9226,
9227, 9222 in that order). Needs Node >= 22 for the built-in WebSocket.

Paper size and margins come from the `@page` rule in the CV itself (`preferCSSPageSize`), and
backgrounds are printed — without that the header colour and zebra rows come out white.

Fallback, if chrome-shared is not available: call the browser directly. The binary name varies
(`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `brave-browser`), so
resolve it with `command -v` and store the hit in config as `browser.pdf_command`:

```bash
$PDF_COMMAND --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=<Firstname>_<Lastname>_CV.pdf <generated>.html
```

Both routes produce the same document — verified page-by-page at pixel level.

A generic starting template with placeholder data lives in the plugin:
`assets/cv-template/build_cv.py`. On first use, copy it, fill it with the candidate's real
data (interview them or parse their existing CV), and keep it as the base variant. Every new
variant = copy the closest existing variant's directory, edit the data, rebuild.

## Tailoring a variant (per job posting)

1. **Headline** (`<h1>`): mirror the role, e.g. "Backend Engineer – Python, PostgreSQL & Event
   Streaming" for a data-heavy ad. Echo the posting's own vocabulary.
2. **Profile paragraph**: 6–10 lines; lead with the 2–3 things the posting cares about most,
   with concrete numbers ("cut p95 latency from 800 to 120 ms", "led a team of five"). A subtle
   nod to the ad's phrasing works well.
3. **Competence table**: reorder rows so the posting's top requirements come first. Rename row
   labels to match the ad's language. Do not pad rows with unknown tech.
4. **Experience bullets**: reorder within each job so the most relevant achievement is first;
   rephrase honestly toward the posting's focus. Same facts, different spotlight.
5. **Market conventions**: EU/PL → photo + GDPR consent footer OK, A4. US employers → NO
   photo, no GDPR footer, Letter size, contact line under the name.

## Honesty rules (hard)

- Only technologies the candidate actually knows. If a posting's key requirement is missing,
  the CV stays silent about it — the gap is addressed in conversation, never papered over.
- No invented employers, dates, or inflated durations. Omitting a job entirely (e.g. a
  very short stint) is allowed and sometimes wise — keep it consistent across all variants
  and note the policy in config or the variant script's docstring.
- Watch dates: "present" only if the candidate is formally still employed.

## Technical notes

- Photo embedded as base64 (`foto.jpeg` copied into each variant dir) — single-file HTML.
- Keep one shared visual style across variants (colors, font, spacing) so the CVs look like
  one person's brand. The template encodes: Carlito/Calibri 10pt, heading color #1F4965,
  gray #595959, zebra rows #F3F6FA, `page-break-inside: avoid` on jobs.
- After generating, ALWAYS copy the PDF into the project workspace root — browser file-upload
  tools typically only accept files under configured workspace roots.
- Read the produced PDF (visual check: page count, no orphaned sections) before sending, and
  show it to the user for approval.
