# Scoring a posting

One definition, used by both skills, so that a score from today's scan means the same as one from
three weeks ago.

**Match score is coverage of the posting's mandatory requirements by the master CV.** Not a feeling
about fit, not a weighting of what seems important — coverage, computed the same way every time.

## Step 1 — blockers are minuses, not a filter

Check `criteria.blockers` from `crek.config.json`, but do not throw a posting away because one fails.
The user decides whether a blocker is really a deal-breaker for this particular posting — an
employment-contract (UoP) offer at a strong rate, a hybrid role one city too far — and they can only decide about what they
see. So a posting that fails a blocker is still read, scored and reported like any other; the
failure lowers its score (Step 4) and appears first in Cons (Minusy) with the specific value that failed.

One case is the exception, because applying is impossible: `locations` — the posting is closed to
the candidate's country. It is still listed in the report, with `—` as the score and the reason in
Cons, but not scored.

`exclude_rejecting_companies` is a minus like the others, not an exclusion. Agencies in particular
recruit for many clients through different recruiters and hiring managers who do not know each other,
so a no from one of them says little about the next role. Name the earlier rejection in Cons with
`report.value.earlier_rejection` from `assets/i18n.json` (EN `earlier rejection #19, 09.09 —
different client` / PL `odrzucenie #19, 09.09 — inny klient`) so the user can judge whether it is
the same door.

| Blocker | Fails when |
|---|---|
| `contract_types` | the posting offers none of the accepted forms (an employment-only posting for a B2B-only candidate) |
| `min_rate` | the **top** of the posted range is below the floor. A range straddling it is not blocked — it is reported with the floor noted |
| `work_modes` + `work_mode_exceptions` | the mode is unacceptable and no exception applies. Exceptions are narrow: read city and rate conditions literally |
| `reject_core_technologies` | the technology is the **core** of the role, not merely a tag among many |
| `reject_languages` | a rejected language is required for the work |
| `exclude_rejecting_companies` | the company already said no to this candidate (check the pipeline: `status=rejected` only — `declined` is the candidate's no to one posting, `skipped` is no decision at all; neither counts) |
| `locations` | the posting is not open to the candidate's country |

A posting with **no rate at all** is not blocked. Report it with the rate column as "not disclosed",
because an unverifiable criterion is different from a failed one.

`criteria.soft.ask_before_reject` is not a blocker. When one of those technologies is a core
requirement, ask the user — that is the whole point of the list.

## Step 2 — list the requirements

Read the posting and write out its requirements, separated into **mandatory** and **nice-to-have**
exactly as the posting separates them. Keep them at the granularity the posting uses; do not merge
"AWS" and "EKS" into one just because both are Amazon, and do not split "CI/CD and release
management" into two.

Watch for the same posting listing requirements twice with different weightings — job boards often
re-sort them. The posting body wins over the board's tag list.

## Step 3 — check each against the inventory

For every requirement, compare against `profile_inventory` (built by the `crek:profile` skill) and
assign one of three states:

- **covered** — the inventory has it at the level the posting asks for, used recently enough to
  defend in an interview
- **partial** — related but not the same, or the right skill at a lower level or several years
  stale. GitLab CI against a GitHub Actions requirement; Terraform last used two years ago against
  "expert, daily". Counts as half
- **not covered** — absent

Record *why* for each partial and each miss, in the posting's own words. "CI/CD only in GitLab
CI, GitHub Actions never used" is usable in the report and in the application; "partial" alone is not.

## Step 4 — compute

```
coverage = (covered + 0.5 × partial) / total mandatory requirements
score     = round(coverage × 10) − 1 × (failed blockers), clamped to 1–10
```

Each failed blocker costs one point, no more. A blocker is a
negative the user can often negotiate around, and so can the company; ranking it far below a genuinely
weak match would hide exactly the postings where a conversation is worth having.

Nice-to-have requirements do not enter the score. They are reported separately as `n/m`, because
they answer a different question — not whether the candidate qualifies, but how much of an edge
they bring.

Two consequences worth stating, since they look like bugs otherwise: a posting with three loose
requirements can outscore one with fifteen precise ones, and a posting whose mandatory list is
mostly soft skills will score high on coverage while saying little about the technical fit. The
score is a measure of match to *what was asked*, not of how good the job is.

## Step 5 — what goes in the report

- **Pros** (`report.col.pros`, PL Plusy) — the covered mandatory requirements that matter most, named concretely
- **Cons** (`report.col.cons`, PL Minusy) — the uncovered mandatory requirements, and the partials with their reason

Neither column carries opinion. Anything that is not a requirement of this posting — the agency
model, the size of the company, a hunch about the team — belongs in the one-line verdict, not here.
