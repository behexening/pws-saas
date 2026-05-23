# Hard-case corpus for the ADF&G PWS announcement parser

## Goal

Build a labelled corpus of every PWS commercial-salmon announcement ADF&G
has issued in the last ~10 years (roughly 2016–2026), with the goal of
finding **non-trivial closure language** — closures that aren't simply
"District N opens at X" or "Subdistrict N closes at Y."

The parser pipeline (`live_test_server.py`) currently does well on the
clean district / subdistrict cases because those dominate the recent
corpus. Edge cases that have caused mis-parses or required manual fixes:

- Stream-mouth-specific closures with hand-described geography
  ("waters within a 500-yard radius of the mouth of X creek")
- "Inside closure area" rectangles with custom lat/lon corners
- Time-windowed openings that overlap with permanent closures
- Combined-gear-type orders ("drift gillnet, set gillnet, and seine
  combined")
- Amendments referencing prior announcement numbers
- Carryover language from previous emergency orders
- "Notwithstanding" / "except" / "excluding" geographic qualifiers
- Per-vessel limits + tier rules that act as soft closures
- Sport-fishing carve-outs adjacent to commercial openings
- Outside-water vs inside-water terminology drift between districts
- Anadromous-water buffer language ("no fishing within 300 ft of any
  flowing fresh-water stream")
- Mt. and St. abbreviation collisions with capitalized place names

A labelled corpus lets us:
1. Quantify how often each hard pattern appears
2. Add regression test fixtures for the parser
3. Decide which patterns to fix in the parser vs. handle in the rendering
4. Spot ADF&G linguistic drift over time

## Source of truth

Primary: **ADF&G's published Emergency Order / Advisory Announcement
archive**. PWS commercial salmon orders live under:

- https://www.adfg.alaska.gov/index.cfm?adfg=commercialbyareapws.salmon
- https://www.adfg.alaska.gov/index.cfm?adfg=commercialbyareapws.eonews

The "EO News" page is the canonical announcement feed; each entry links
to a PDF.

Secondary: our own `announcements` table holds the parsed-by-us PDFs
since the Mailgun pipeline went live (2026-04 onwards). That covers the
last ~6 weeks, not the 10-year scope.

Tertiary: ADF&G may have an FOIA / public-records request path for
older PDFs that aren't on the web. Worth asking the Cordova or
Anchorage office.

## Plan

### Phase 1 — Scrape

- [ ] Audit the EO News page structure (pagination, year filters, URL
  patterns). Confirm whether the archive goes back 10 years or if there
  are stale links pointing at offline PDFs.
- [ ] Build a small Python scraper (`scripts/scrape_eo_archive.py`) that:
  - Walks every year filter from 2016 → current
  - Pulls every PDF link
  - Saves PDFs to `data/eo_archive/<year>/<announcement_id>.pdf` with a
    sidecar `.json` of metadata (issue date, district, EO number, URL)
- [ ] Handle rate limiting / retries. ADF&G's site isn't a CDN; don't hammer.
- [ ] Verify deduplication — the same EO can appear under multiple
  district landing pages.

### Phase 2 — Extract text

- [ ] PDF → text via `pdfplumber` (already in our requirements). For
  each PDF, write `<id>.txt` alongside it.
- [ ] Some early PDFs are scanned images — flag those for OCR via
  `pdfplumber` page.images or fall back to Tesseract.
- [ ] Sanity-check: pick 20 random PDFs and eyeball that the .txt
  preserves district names, lat/lons, times.

### Phase 3 — Classify

- [ ] Run each .txt through the live parser (`live_test_server.py` in a
  batch mode). Capture the JSON output + the parser's confidence /
  warning fields.
- [ ] Annotate each output as **clean** (district + subdistrict only)
  vs **hard case** (anything else).
- [ ] For each hard case, tag the pattern(s) present:
  `stream-mouth-radius`, `custom-lat-lon-box`,
  `notwithstanding-clause`, `combined-gear`, etc.
- [ ] Build a CSV (`data/eo_archive/hard_cases.csv`) with
  columns: `announcement_id, issue_date, district, hard_case_tags,
  parser_output_summary, manual_review_status`.

### Phase 4 — Quantify + prioritize

- [ ] Tally how often each hard pattern appears across the 10-year corpus.
- [ ] Rank by frequency.
- [ ] Pick the top 3–5 patterns to fix in the parser; write specific
  prompt-engineering or regex pre-processing tweaks for each.
- [ ] Add the rare-but-impactful cases (e.g., custom lat-lon boxes) to a
  test fixture set the parser is regression-tested against.

## Deliverables

- `scripts/scrape_eo_archive.py` — the scraper
- `data/eo_archive/<year>/<id>.{pdf,txt,json}` — the corpus
- `data/eo_archive/hard_cases.csv` — the labelled hard-case index
- `data/eo_archive/REPORT.md` — frequency tally + recommended parser fixes
- A follow-up PR (or series) that lands the parser improvements

## Not in scope

- Retroactively re-parsing the historical PDFs to populate
  `announcements` + `parsed_results` — too risky to touch the live
  alerting pipeline retroactively. The corpus is for parser improvement
  only.
- Sport-fishing or subsistence emergency orders. Commercial salmon only.
- Districts outside PWS.

## Open questions

- Does ADF&G have a structured API for historical EOs, even an internal
  one? Worth asking before scraping.
- For the OCR'd / scanned older PDFs, accept that the corpus quality
  drops the further back you go. Probably 2018+ is solid, 2016–2017 is
  best-effort.
- If 10 years is too much volume, scope back to 5 (~2021+); coverage
  during the modern PWS regulatory regime is what matters most.
