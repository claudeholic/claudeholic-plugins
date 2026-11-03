---
name: profile
description: "Czyta główne CV kandydata i buduje z niego profil umiejętności, wobec którego CREK ocenia ogłoszenia. Używaj, gdy użytkownik pisze np. „zmieniłem CV”, „zaktualizowałem CV”, „przeczytaj CV od nowa”, „odśwież profil umiejętności”, przy wywiadzie startowym i gdy inny skill zgłasza nieaktualny profil. EN: read the master CV and turn it into the skill inventory postings are scored against. Use at bootstrap, after the CV changes ('I updated my CV') or when another skill reports the inventory as stale."
---

**Plugin root: `${CLAUDE_PLUGIN_ROOT}`** — commands in `references/*.md` (and in the other CREK skills' references) write `${CLAUDE_PLUGIN_ROOT}`, which is filled in only in this file, not there and not in the Bash tool: always run them with the path above in its place.

# Profile — what the CV actually claims

Match scores are coverage: how much of a posting's requirements the candidate can evidence. That
only works if "what the candidate can evidence" is a fixed, written list rather than whatever the
model remembers mid-conversation. This skill produces that list.

**The master CV is the only source.** `cv.master` in `crek.config.json` — the CV a stranger would
receive, the one behind `cv.public_url`. Tailored variants in the CV directory are derived from it
and must never be read here: a CV written for a posting always covers that posting, so scoring
against it would return a perfect match every time and mean nothing.

## Procedure

1. **Read the config** — `crek.config.json` in the project directory. If it does not exist, this
   is the first run: tell the user, offer the bootstrap interview
   (`../apply/references/bootstrap.md`, which calls this skill at its CV step) and build the
   inventory as part of it. Check `cv.master` exists (absolute, or relative to the config). If anything looks off, run
   `node "${CLAUDE_PLUGIN_ROOT}/assets/crek-config-check.mjs" crek.config.json`.

2. **Extract the text**: `pdftotext -layout <master.pdf> -`. If `pdftotext` is missing, open the PDF
   in the browser through chrome-shared and read it there.

3. **Build the inventory.** For every skill the CV genuinely claims, record:
   - `name` — as a recruiter would search for it
   - `level` — `expert` / `strong` / `working` / `exposure`, from how the CV presents it
   - `last_used` — `YYYY-MM` or `current`, taken from the employment dates the skill sits under
   - `evidence` — which employer or project shows it
   - `aliases` — other names postings use (EKS ↔ Kubernetes, Postgres ↔ PostgreSQL)

   Also collect `domains` (payments, banking, telco, media — postings often ask for industry rather
   than technology), `roles`, `certifications`, `education` (degrees and postgraduate studies — postings often require a degree), `years_experience` and `headline`.

   Two rules decide quality here. **Claim nothing the CV does not show**: if it is not on the page,
   it is not in the inventory, however sure you are that the candidate can do it — the inventory is
   what can be defended in an interview, not what is true in general. And **record recency
   honestly**: a technology last touched two years ago is not the same as one used daily, and a
   posting demanding expert level in it is a gap, not a match. Getting this wrong produces
   applications that fall apart at the technical stage.

4. **Ask the user about gaps.** Technologies that keep appearing in postings and are absent from the
   CV go into `gaps`, with whatever the user says about them — being learned, deliberately avoided,
   used but not worth listing. This is the list the reports will quote, so it is worth getting from
   the user rather than inferring.

5. **Write it back** to `profile_inventory` in the config, with `generated_at` and
   `source_sha256`, and set `cv.master_sha256` to the same value — the SHA-256 of the master CV
   (`sha256sum <master.pdf>`). Both fields, always together: `crek-config-check.mjs` compares each
   with the file on disk, and the checksum is what lets other skills notice the CV has moved on
   without the inventory following it.

6. **Report**: how many skills, which domains, and the gaps — so the user can see what the pipeline
   will be scoring against and correct it now rather than after ten applications.

## When it is stale

`crek-config-check.mjs` compares `cv.master_sha256` and `profile_inventory.source_sha256` with the
file on disk on every run. A mismatch means the CV changed: rerun this skill before scoring
anything. Do not patch the inventory by hand
in passing — a half-updated inventory is worse than an obviously old one, because nothing flags it.
