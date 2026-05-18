# Visual Distinguishers — akFISHinfo

Design moves that make the product look like *this product* (commercial salmon openers, ADF&G data, PWS) rather than another well-designed dev tool. Pulled from `design inspirations.md` and filtered against the niche.

---

## Hapag-Lloyd / heraldry / PSA graphics

These three cluster into one move: the product is a civic bulletin from a state agency, delivered to commercial mariners. Lean into that visual register.

- **Parsed announcement page as a PSA notice** — dated masthead, issue number, "ADVISORY" header, flat color blocks. Not a SaaS card. No other fishing app reads this way.
- **Modular sub-mark in the Hapag-Lloyd register** — a heavy geometric monogram derived from the Blackbird wordmark, usable as favicon and as a captain's emblem on `/account`.
- **Heraldic glyph per PWS district** — each of the 5 districts gets its own mark. Memorable, owned, structurally useful as a map legend key.

---

## Information density / Designers Republic / low-kerning Helvetica

The current `9px uppercase 0.14em letter-spacing` labels already gesture here. Push further.

- **Stat area codes as industrial part numbers** — `212-10`, `226-30` typeset in tabular mono, `[bracket]` enclosures, leading zeros preserved.
- **Visible telemetry strip** — last-parsed timestamp, announcement ID, content hash prefix rendered as chrome, not hidden. Commercial users trust visible provenance.

---

## Linocut

Alaska/PNW has a deep block-print tradition (Sitka, Tlingit formline). One commissioned hand-cut salmon mark used as page furniture instantly localizes the product. This is the single thing a model cannot emit by default.

---

## Wii-style grid of tiles (structure only, no pastel)

Use the *channels* layout idea for the district picker: a grid of equal tiles, each district a single tile with its heraldic glyph + flat color band + status. Drop the rounded pastel surfaces — keep the modular structure.

Applies cleanly to:
- District selector on `/app`
- Tier picker on `/pricing`
- Live announcement index on the landing page

---

## What this buys vs generic AI-coded SaaS

The current design language already avoids the obvious tells (no rounded-2xl, no emoji, sharp 4–6px corners, dense labels). What it lacks is *evidence of place* — nothing yet says "Prince William Sound salmon openers" rather than "well-designed dev tool." The PSA framing, district heraldry, and one linocut mark are the cheapest three moves that fix that.
