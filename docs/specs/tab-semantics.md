# Tab Semantics — The Source of Truth

This document defines exactly what each tab on the map page (`/app`) shows.
If anything here is wrong or ambiguous, fix it BEFORE writing code.

## The Unit of Display Is the Opener, Not the Announcement

An **announcement** is a row in `parsed_results`. It is a PDF that ADF&G
emailed us. It is the container, not the thing being displayed.

An **opener** is a single `(district, opens_at, closes_at)` tuple. One
announcement contains one or more openers. In the parsed HTML this is
represented as one `<div class="time-block">` inside a `.district-card`,
with raw AKDT wall-clock ISO strings in its two `.time-val` cells.

> Tabs filter at the OPENER level. The announcement's wrapper window
> (`earliest_opens_at` / `latest_closes_at` on the row) and the
> `announcement_date` are IRRELEVANT to tab decisions. They describe
> the PDF. They do not describe whether anything is open.

## Tab Definitions (Alaska time)

Let `now` = current UTC instant. Let `opens` / `closes` = the AKDT
wall-clock timestamps on a specific opener, converted to UTC ms.

| Tab | An opener belongs here when |
|---|---|
| **Live** | `opens <= now < closes` |
| **Upcoming** | `now < opens` |
| **Old** | `closes <= now` |

Transitions are exact:
- An opener appears in **Live** the instant `now` reaches `opens`.
- An opener leaves **Live** and appears in **Old** the instant `now` reaches `closes`.
- An opener never appears in two tabs at the same `now`.

## What Each Tab Renders

### Live tab
- Show every opener that is currently live, grouped under its district card.
- Sort the visible district cards by `closes` ascending (soonest-to-close first — most urgent at the top).
- Header: "Open through [closes_at of the soonest-closing visible opener]".
- If zero openers qualify → empty state. Do NOT render an announcement just to show its publication date.

### Upcoming tab
- Show every opener that is still in the future, grouped under its district card.
- Sort the visible district cards by `opens` ascending (soonest-to-open first).
- Header: "Opens [opens_at of the soonest-opening visible opener]".
- If zero openers qualify → empty state.

### Old tab
- Show every opener that has already closed.
- Date scrubber: one entry per unique opener date (see "Open Question 1" below).
- When the user scrubs to a date, show only the opener(s) whose `(opens, closes)` window includes that date.
- Header: actual time range of the opener(s) visible at the current scrubber position. NEVER the announcement's wrapper.
- If zero openers qualify → empty state.

## What This Means For Announcement #14 Today (2026-05-27, 11am AKDT)

Ann #14 contains:
- Flats: `2026-05-26T07:00 → 2026-05-26T20:00`
- Montague: `2026-06-01T07:00 → 2026-06-01T20:00`
- Southwestern: `2026-06-01T07:00 → 2026-06-01T20:00`

Each opener belongs on exactly one tab right now:
- Flats → **Old** (closed last night at 8pm)
- Montague → **Upcoming** (opens June 1)
- SW → **Upcoming** (opens June 1)

Therefore:
- **Live** should show NOTHING from ann #14. If the live SQL still returns ann #14 because its wrapper overlaps now, the frontend must filter it out at the opener level.
- **Upcoming** should show Montague + SW only (Flats is hidden because it's already past).
- **Old** with scrubber at May 26 should show Flats only (Montague + SW are hidden because they're still future).

## Headers Per Tab On That Day

- **Live**: empty state — "Nothing currently open."
- **Upcoming**: "Opens Jun 1, 7am AKDT"
- **Old** (scrubber on May 26): "May 26, 7am – 8pm AKDT" — the Flats opener's actual window.

The strings "May 23", "May 26 – Jun 3", "ANN #14", etc., must NEVER appear in the header. They are metadata about the PDF. They are not openers.

## Implementation Invariants

1. **All date math goes through `_akdtIsoToMs()`** in `public/app.html`. No inline `new Date(...)` of ISO strings. AKDT is UTC-8 (DST); the helper shifts by +8h.
2. **Every tab decision derives from `.time-block` elements**, never from `result.earliest_opens_at` / `result.latest_closes_at` / `result.announcement_date`. Those three fields are valid for SQL pre-filtering only.
3. **If no opener qualifies for the current tab, render the empty state.** Do not pick an arbitrary announcement just to have something on screen.
4. **Status badge ("Live Now" / "Opens X" / "Period Ended") is computed from visible openers.** If zero openers are visible, no badge.

## Locked Decisions

### Q1 — Scrubber is per DAY, not per opener
The Old tab scrubber walks **calendar days** (AKDT). An opener
running `May 26 7am → May 28 8pm` registers May 26, May 27, AND
May 28 on the scrubber. Days where NO opener was active are skipped
(if nothing happened May 23-25, those ticks do not exist; the
scrubber jumps from May 22 → May 26). Capped at today — no future
days on the Old tab.

### Q2 — Picker is per OPENER, not per announcement
The Old tab's left-side picker shows one row per opener. If ann #14
contains Flats / Montague / SW, those are three separate picker
rows. The announcement is just attribution metadata on the row;
the user is selecting an opener, not a PDF.

Row label format: `District · Mon D, Xam–Ypm`
Example: `Copper River Flats · May 26, 7am–8pm`

Sort order in the picker: by `opens_at` ascending (soonest-to-open
first, regardless of source announcement).

### Q3 — Multiple openers on the same scrubber day all render together
If Flats AND Coghill were both active on May 26, scrubbing to May 26
on the Old tab shows BOTH cards together. If Flats closed that night
but Coghill kept running into May 27, scrubbing to May 27 shows
Coghill alone. Cards are sorted by their `opens_at` time of day
(earliest first).

### Picker scope
Only the Old tab has the per-opener picker. Live and Upcoming render
a single panel showing whichever opener(s) are currently relevant
(per the tab's filter rule). No picker on those two.

### Header line
Yes, keep the header. When exactly one opener is visible it reads
that opener's window (e.g. `May 26, 7am–8pm`). When multiple openers
are visible it reads the date only (e.g. `May 26`). Empty when zero
openers are visible.

---

## Implementation Plan

1. Live / Upcoming SQL: stay broad (any wrapper overlap). Frontend
   selects the soonest-relevant single row whose openers qualify;
   shows empty state otherwise.
2. Old SQL: any row with `earliest_opens_at < NOW()` (already done
   in PR #82).
3. Old tab eagerly loads `_html` for every row in `allResults`,
   then extracts every `(districtKey, opens, closes)` opener tuple
   across all rows into one flat `allOpeners` array.
4. `buildScrubberDates(allOpeners)` returns unique AKDT calendar
   days where at least one opener was active, capped at today,
   sorted ascending.
5. Ann-list picker re-renders to one row per opener, sorted by
   `opens_at`, label `District · Mon D, Xam–Ypm`. Clicking a row
   moves the scrubber to that opener's open date and renders that
   day.
6. Renderer assembles visible cards from whichever row(s) contain
   openers active on the current scrubber day. Multi-row case is
   handled by pulling each opener's source card from its parent
   `_html` and merging into the grid.
7. Header text derived from visible openers per the spec.
