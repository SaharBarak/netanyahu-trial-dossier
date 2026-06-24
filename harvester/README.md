# Reported-Record Harvester

Builds a sourced, dated index of the trial's testimony phase from **public news
articles**. It is the most faithful reconstruction possible given that **no
public verbatim transcript exists** (see `../docs/06-transcript-research.md`).

## What it does / doesn't

- ✅ Fetches each seed URL and extracts **metadata only**: title, publish date,
  author, and the publisher's own dek **truncated to ≤14 words**.
- ✅ Writes `data/manifest.json` (machine) and `docs/07-reported-record.md`
  (human index, grouped by trial phase, sorted by date).
- ✅ Fails gracefully — unreachable sources are flagged in the output, not
  dropped silently.
- ❌ Never stores article body text (copyright). It stores links + metadata.
- ❌ Does not claim to be a transcript. Every row is labeled as reporting.

## Run

```bash
node harvester/harvest.mjs            # fetch + regenerate manifest & index
node harvester/harvest.mjs --dry-run  # validate seeds, no network
node harvester/harvest.mjs --delay 2000  # politeness delay between requests (ms)
```

Requires Node ≥ 18 (global `fetch`). Zero dependencies.

## Extend

Add rows to `seeds.json` — `{ date, phase, case, publication, theme, url }`.
`date` is the hearing/event date when known; otherwise the harvester falls back
to the article's publish date. Re-run to regenerate. Idempotent.

`phase` ∈ `pretrial · A-direct · B-cross · C-reexam · evidence · analysis ·
logistics · cancellations · context`.
