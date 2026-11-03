#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""CV variant template — copy this directory per job/variant, replace placeholder data.

Pattern: all content lives in the Python data structures below; the script renders a single
self-contained HTML file; convert it to PDF through the browser chrome-shared keeps running:

    python3 build_cv.py && node "${CLAUDE_PLUGIN_ROOT}/assets/html-to-pdf.mjs" First_Last_CV.html

Fallback without chrome-shared (the binary name varies: google-chrome, chromium, ... — use the
one stored in crek.config.json browser.pdf_command):

    $PDF_COMMAND --headless --disable-gpu --no-pdf-header-footer \
        --print-to-pdf=First_Last_CV.pdf First_Last_CV.html

Every string below is inserted into the HTML AS IS — it is HTML, not plain text (that is how
&bull;, <b> and line breaks work). Write it yourself from the candidate's real data; never paste
raw text from a job posting or a web page here: markup or script in it would end up in the page
the browser renders.

Naming: the directory is named <Company>_<job id> and carries the tailoring information;
the FILE is always plain <Firstname>_<Lastname>_CV. Never put the variant in the filename
or in the HTML <title> — the employer sees both, and a tailored name reveals that the CV
was written for their posting.

Market conventions:
- EU/PL: photo + GDPR footer, @page size A4 (set PHOTO = True, GDPR_FOOTER = True)
- US: no photo, no GDPR footer, @page size Letter

Honesty: only real skills, employers and dates. Tailor by REORDERING and REPHRASING,
never by inventing.
"""
import base64
import pathlib

HERE = pathlib.Path(__file__).parent

# ------------- variant switches -------------
PHOTO = True            # False for US-style
GDPR_FOOTER = True      # False for US-style
PAGE_SIZE = "A4"        # or "Letter"
HEADLINE = "Senior Example Engineer – Speciality One & Speciality Two"  # mirror the posting
NAME = "First Last"
CONTACT_LINES = [
    "City, Country (remote) &bull; +00 000 000 000",
    "email@example.com",
    "https://www.linkedin.com/in/example/",
]
OUTPUT_BASENAME = "First_Last_CV"   # <Firstname>_<Lastname>_CV — never encode the variant here

# ------------- content -------------
PROFILE = (
    "Engineer with N+ years of ... Lead with the 2-3 things THIS posting cares about most, "
    "with concrete numbers. 6-10 lines, justified. Close with a line that echoes the "
    "posting's own phrasing."
)

# (label, description) — order rows so the posting's top requirements come first
competences = [
    ("Speciality One", "Tool A, Tool B, Tool C; concrete achievements/scale"),
    ("Speciality Two", "Tool D, Tool E; scope notes"),
    ("Everything Else", "Honest kitchen sink, grouped sensibly"),
]

# newest first; bullets ordered most-relevant-first FOR THIS POSTING
experience = [
    {
        "company": "Current Corp", "role": "Role Title",
        "dates": "01/2020 - present", "duration": "5 years",
        "bullets": [
            "Most relevant achievement for this posting, with numbers.",
            "Second achievement.",
        ],
        "tech": "Tool A, Tool B, Tool C",
    },
]

# (company, role, dates, duration, one-line description) — older roles, compact form
earlier = [
    ("Old Co", "Junior Role", "01/2010 - 12/2012", "3 years",
     "One-line scope summary. Technologies: X, Y."),
]

certificates = [
    "Certificate name - date",
]

EDUCATION = [
    ("2005 - 2010", "Degree, University, specialization."),
]

LANGUAGES = "Native - native, English - C1"
INTERESTS = "A real, memorable interest or two (great icebreakers); hobbies"

# ------------- rendering (keep visual style consistent across variants) -------------
BLUE = "#1F4965"
GRAY = "#595959"
ROWBG = "#F3F6FA"

photo_html = ""
if PHOTO:
    photo_path = HERE / "foto.jpeg"
    if photo_path.exists():
        photo_b64 = base64.b64encode(photo_path.read_bytes()).decode()
        photo_html = f'<img src="data:image/jpeg;base64,{photo_b64}" alt="">'
    else:
        print(f"NOTE: {photo_path.name} not found - building without a photo. "
              f"Drop a photo there and rerun, or set PHOTO = False.")


def comp_rows():
    out = []
    for i, (label, value) in enumerate(competences):
        bg = f' style="background:{ROWBG}"' if i % 2 == 0 else ""
        out.append(f"<tr{bg}><th>{label}</th><td>{value}</td></tr>")
    return "\n".join(out)


def exp_blocks():
    out = []
    for job in experience:
        bullets = "\n".join(f"<li>{b}</li>" for b in job["bullets"])
        tech = (f'<p class="tech"><span class="lbl">Technologies:</span> {job["tech"]}</p>'
                if job.get("tech") else "")
        out.append(f"""
<div class="job">
  <h3>{job['company']} &mdash; {job['role']}</h3>
  <p class="meta">{job['dates']} | {job['duration']}</p>
  <ul>{bullets}</ul>
  {tech}
</div>""")
    return "\n".join(out)


def earlier_blocks():
    out = []
    for company, role, dates, dur, desc in earlier:
        out.append(f"""
<div class="early">
  <h4>{company} <span class="sep">|</span> {role} <span class="sep">|</span> {dates} <span class="sep">|</span> {dur}</h4>
  <p>{desc}</p>
</div>""")
    return "\n".join(out)


gdpr = ""
if GDPR_FOOTER:
    gdpr = ('<div class="footer">I hereby authorize you to process my personal data included '
            'in my job application for the needs of the recruitment process.</div>')

edu = "\n".join(f'<p><span class="yr">{yr}:</span> {desc}</p>' for yr, desc in EDUCATION)
certs = "\n".join(f"  <li>{c}</li>" for c in certificates)
contact = "<br>\n      ".join(CONTACT_LINES)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{NAME} - CV</title>  <!-- Chrome copies this into the PDF Title field -->
<style>
  @page {{ size: {PAGE_SIZE}; margin: 12mm 13mm; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: Carlito, Calibri, "Liberation Sans", sans-serif;
         font-size: 10pt; line-height: 1.34; color: #000; margin: 0; }}
  a {{ color: {BLUE}; text-decoration: none; }}
  .header {{ display: flex; gap: 14px; align-items: flex-start; margin-bottom: 4px; }}
  .header img {{ width: 118px; border-radius: 3px; flex: none; }}
  .htext {{ padding-top: 2px; }}
  h1 {{ font-size: 14pt; color: {BLUE}; margin: 0 0 2px; letter-spacing: .1px; }}
  .name {{ font-size: 12pt; font-weight: bold; margin: 0 0 5px; }}
  .contact {{ font-size: 9pt; line-height: 1.42; }}
  h2 {{ font-size: 11.5pt; color: {BLUE}; text-transform: uppercase; margin: 13px 0 5px;
       padding-bottom: 2px; border-bottom: 1.2px solid {BLUE}; letter-spacing: .3px;
       break-after: avoid; page-break-after: avoid; }}
  p.profile {{ margin: 0; text-align: justify; }}
  table.comp {{ width: 100%; border-collapse: collapse; }}
  table.comp th {{ color: {BLUE}; font-weight: bold; text-align: left; vertical-align: top;
                  width: 27%; padding: 3.6px 8px 3.6px 7px; font-size: 9.5pt; }}
  table.comp td {{ vertical-align: top; padding: 3.6px 7px 3.6px 0; font-size: 9.5pt; }}
  .job {{ margin-bottom: 9px; page-break-inside: avoid; }}
  .job h3 {{ font-size: 10.5pt; color: {BLUE}; margin: 0 0 1px; }}
  .meta {{ font-size: 9pt; font-style: italic; color: {GRAY}; margin: 0 0 3px; }}
  .job ul {{ margin: 0 0 3px; padding-left: 15px; }}
  .job li {{ margin-bottom: 1.2px; }}
  .tech {{ margin: 0; font-size: 9.5pt; }}
  .lbl {{ font-weight: bold; }}
  .early {{ margin-bottom: 6px; page-break-inside: avoid; }}
  .early h4 {{ font-size: 10pt; color: {BLUE}; margin: 0 0 1px; font-weight: bold; }}
  .early .sep {{ color: {GRAY}; font-weight: normal; }}
  .early p {{ margin: 0 0 0 12px; font-size: 9.5pt; }}
  ul.plain {{ margin: 0; padding-left: 15px; }}
  .edu p {{ margin: 0 0 3px; }}
  .edu .yr {{ font-weight: bold; }}
  .footer {{ margin-top: 14px; font-size: 6.6pt; color: {GRAY}; line-height: 1.3;
            text-align: justify; }}
</style>
</head>
<body>
<div class="header">
  {photo_html}
  <div class="htext">
    <h1>{HEADLINE}</h1>
    <p class="name">{NAME}</p>
    <div class="contact">
      {contact}
    </div>
  </div>
</div>
<h2>Profile</h2>
<p class="profile">{PROFILE}</p>
<h2>Core Competences</h2>
<table class="comp">
{comp_rows()}
</table>
<h2>Professional Experience</h2>
{exp_blocks()}
<h2>Earlier Experience</h2>
{earlier_blocks()}
<h2>Education</h2>
<div class="edu">
{edu}
</div>
<h2>Certificates and Courses</h2>
<ul class="plain">
{certs}
</ul>
<h2>Languages and Interests</h2>
<p style="margin:0 0 2px"><span class="lbl">Languages:</span> {LANGUAGES}</p>
<p style="margin:0"><span class="lbl">Interests:</span> {INTERESTS}</p>
{gdpr}
</body>
</html>"""

out = HERE / f"{OUTPUT_BASENAME}.html"
out.write_text(html, encoding="utf-8")
print(f"OK: {out}  ({len(html)} chars)")
