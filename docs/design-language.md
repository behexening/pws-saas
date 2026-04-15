# akFISHinfo — Design Language

Reference for all pages. All new pages should use these tokens and patterns verbatim.

---

## Color Tokens

```css
:root {
  --bg:      #060a0f;   /* Page background — very dark navy-black */
  --surface: #0d1520;   /* Card / panel background */
  --border:  #1a2d3f;   /* All borders and dividers */
  --text:    #dde8f4;   /* Primary body text */
  --muted:   #5a7288;   /* Labels, secondary text, nav links */
  --accent:  #00b4d8;   /* Cyan — links, active states, CTA buttons, highlights */
  --open:    #22c55e;   /* Green — "open" status, success states */
  --warn:    #f59e0b;   /* Amber — trial, warning states */
  --red:     #ef4444;   /* Red — errors, "closed" status, destructive */
}
```

---

## Typography

### Wordmark / Headings
- **Font:** Projekt Blackbird (`/static/projekt-blackbird-v2.otf`)
- `@font-face` name: `'Blackbird'`
- Used for: page `h1`, `.wordmark`
- The wordmark always reads `akFISH<em>info.</em>` — the `em` tag is unstyled except `font-style: normal; color: var(--accent)`.

```css
@font-face {
  font-family: 'Blackbird';
  src: url('/static/projekt-blackbird-v2.otf') format('opentype');
}

.wordmark {
  font-family: 'Blackbird', sans-serif;
  font-size: 19px;
  letter-spacing: 0.03em;
  color: var(--text);
  user-select: none;
}
.wordmark em { font-style: normal; color: var(--accent); }
```

### Body / UI Text
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif`
- Base size: `13–14px`
- `-webkit-font-smoothing: antialiased` on `body`

---

## Navigation Bar

Sticky, 50px tall, `rgba(6,10,15,0.95)` background with `border-bottom: 1px solid var(--border)`.

```html
<nav>
  <div class="wordmark">akFISH<em>info.</em></div>
  <div class="nav-links">
    <a href="/app"         class="nav-link">map</a>
    <a href="/account"     class="nav-link active">account</a>
    <a href="/auth/logout" class="nav-link">sign out</a>
  </div>
</nav>
```

```css
nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  height: 50px;
  background: rgba(6,10,15,0.95);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 12px;
  font-weight: 500;
  transition: color 0.15s;
}
.nav-link:hover  { color: var(--text); }
.nav-link.active { color: var(--text); }
```

---

## Cards

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;          /* 5–6px throughout */
  padding: 18px 20px;
  margin-bottom: 14px;
}
```

Featured/highlighted cards get `border-color: var(--accent)` and a subtle glow:

```css
.card.featured {
  border-color: var(--accent);
  box-shadow: 0 0 28px rgba(0,180,216,0.08);
}
```

---

## Buttons

```css
.btn {
  display: inline-block;
  padding: 7px 16px;
  border-radius: 4px;
  font-size: 11–12px;
  font-weight: 700;
  letter-spacing: 0.04–0.05em;
  text-transform: uppercase;
  cursor: pointer;
  border: none;
  font-family: inherit;
  text-decoration: none;
  transition: opacity 0.15s;
}
.btn:hover { opacity: 0.82; }

/* Primary — cyan fill, black text */
.btn-primary { background: var(--accent); color: #000; }

/* Ghost — transparent with border */
.btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
```

Full-width block buttons use `display: block; width: 100%;`.

---

## Form Fields

```css
.field label {
  display: block;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin-bottom: 5px;
}
.field input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  padding: 8px 11px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.field input:focus { border-color: var(--accent); }
```

---

## Badges / Status Pills

Inline status indicators. Font: 9px, 700 weight, uppercase, letter-spacing 0.08–0.16em.

```css
.badge { display: inline-block; font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 2px; letter-spacing: 0.08em; text-transform: uppercase; }

.badge-pro   { background: rgba(0,180,216,0.12);  color: var(--accent); border: 1px solid rgba(0,180,216,0.25); }
.badge-trial { background: rgba(245,158,11,0.12); color: var(--warn);   border: 1px solid rgba(245,158,11,0.28); }
.badge-free  { background: rgba(90,114,136,0.12); color: var(--muted);  border: 1px solid var(--border); }
.badge-gov   { background: rgba(34,197,94,0.12);  color: var(--open);   border: 1px solid rgba(34,197,94,0.25); }
.badge-ok    { background: rgba(34,197,94,0.12);  color: var(--open);   border: 1px solid rgba(34,197,94,0.25); }
.badge-warn  { background: rgba(245,158,11,0.12); color: var(--warn);   border: 1px solid rgba(245,158,11,0.28); }
```

---

## Alert Banners

```css
.alert-ok  { background: rgba(34,197,94,0.10);  border: 1px solid rgba(34,197,94,0.25);  color: #4ade80; }
.alert-err { background: rgba(239,68,68,0.10);  border: 1px solid rgba(239,68,68,0.25);  color: #f87171; }
.alert-warn { background: rgba(245,158,11,0.07); border: 1px solid rgba(245,158,11,0.22); color: var(--warn); }

/* Shared */
.alert { border-radius: 4px; padding: 9px 12px; font-size: 12px; margin-bottom: 12px; }
```

---

## Section Labels (Card Titles)

Used inside cards above their content, separated by a bottom border:

```css
.card-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
```

---

## Info Rows

Horizontal label + value pairs inside cards:

```css
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(26,45,63,0.5);
  font-size: 13px;
}
.info-row:last-child { border-bottom: none; }
.info-label { color: var(--muted); font-size: 11px; }
```

---

## Page Layout (content pages — not app)

```css
.page {
  max-width: 480–600px;   /* 480px for centered single-column, 600px for account */
  margin: 44–64px auto;
  padding: 0 20–24px 60–80px;
}
h1 {
  font-family: 'Blackbird', sans-serif;
  font-size: 1.6–2rem;
  letter-spacing: 0.01em;
  margin-bottom: 4–10px;
}
h1 em { font-style: normal; color: var(--accent); }
.page-sub { color: var(--muted); font-size: 12–13px; margin-bottom: 32–40px; }
```

---

## Rules

- **No emojis** in any UI element (backend console logs are fine)
- **No border-radius above 6px** — use 4–6px throughout
- **Accent is cyan `#00b4d8`** — never blue (`#5b8dee` is retired)
- **Open/active green is `#22c55e`** — not `#27ae60`
- Closed/error red is `#ef4444` — not `#e74c3c`
- Warn/trial amber is `#f59e0b` — not `#f39c12`
- All dividers use `var(--border)` (`#1a2d3f`) or `rgba(26,45,63,0.5)` for subtler separators
- The "Not live data" / legal disclaimer overlay uses amber warn color against a translucent dark surface
