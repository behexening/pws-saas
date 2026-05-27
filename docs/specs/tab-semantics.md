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

## Open Questions To Confirm Before Any More Code Changes

These are points where I (Claude) am unsure how you want it. I will not
assume. Please tick the one you want for each.

### Q1: Multi-day openers on the Old tab scrubber

An opener that ran `May 26 7am → May 28 8pm` is a single opener spanning
three days. On the Old tab scrubber, does it:

- **(a)** Surface as one entry "May 26–28" — user picks one position to see the opener
- **(b)** Surface as three entries May 26 / May 27 / May 28 — each day is its own scrubber stop, and the same opener card is visible at all three positions
- **(c)** Surface as one entry on its OPEN date (May 26) only

### Q2: Multiple openers in one announcement on the ann-list picker

Today the Old tab has an "announcement picker" (the `.ann-list` rows on
the left). Each row currently represents one announcement (= one PDF).
If ann #14 has three openers (Flats, Montague, SW), do you want:

- **(a)** One picker row per announcement, as today, and the scrubber + per-block filter handles which openers are visible.
- **(b)** One picker row per opener (Flats / Montague / SW each get their own row, all attributed to ann #14).

### Q3: Old tab when scrubbed to a multi-opener day

If two separate openers both happened on May 26 — say Flats AND Coghill —
and the user scrubs to May 26 on the Old tab, should the page show:

- **(a)** Both Flats and Coghill cards together with header "May 26, …"
- **(b)** Only one at a time, with the picker letting them switch

---

After these are confirmed, the code changes are:
1. Live / Upcoming SQL: stay broad (any wrapper overlap). Frontend skips
   rows with no qualifying opener.
2. Old SQL: any row with `earliest_opens_at < NOW()` (at least one
   started opener). Already done.
3. Scrubber: one entry per (per Q1 above).
4. Renderer: every header / badge / list-row label derives from openers,
   never from wrapper / announcement_date.
