# Plan: /about Page

**Goal:** Create a standalone `/about` page for akFISHinfo covering: what it does, who it's for, how the pipeline works, and the team/origin story. Link it from all nav bars.

**Scope:** 3 implementation phases + verification. Each phase is self-contained for a fresh chat context.

---

## Phase 0: Context (pre-read before starting any phase)

### Design tokens (from `docs/design-language.md`)
```
--bg:      #060a0f    --surface: #0d1520    --border:  #1a2d3f
--text:    #dde8f4    --muted:   #5a7288    --accent:  #00b4d8
--open:    #22c55e    --warn:    #f59e0b    --red:     #ef4444
```
Font: Blackbird (`/static/projekt-blackbird-v2.otf`) for `h1`/wordmark only. System font everywhere else.

### Backend route pattern (from `backend_v2.js` lines 1120–1127)
All HTML pages are served with `app.get('/route', handler)` → `res.sendFile(path.join(__dirname, 'public', 'page.html'))`. The `/about` page is public — no auth check needed (same as `/login`). `express.static` at line 1224 is the catch-all, but explicit routes take precedence and should be used for documented pages.

### Nav bar HTML pattern (copy from `public/account.html` lines 219–226)
```html
<nav>
  <div class="wordmark">akFISH<em>info.</em></div>
  <div class="nav-links">
    <a href="/app"         class="nav-link">map</a>
    <a href="/about"       class="nav-link">about</a>
    <a href="/account"     class="nav-link">account</a>
    <a href="/auth/logout" class="nav-link">sign out</a>
  </div>
</nav>
```
Active page link gets class `nav-link active` (color: var(--text)).

### Page layout pattern (from `public/account.html`)
```html
<div class="page">
  <h1>Section <em>title.</em></h1>
  <p class="page-sub">Subtitle text</p>
  <div class="card"> ... </div>
</div>
```
```css
.page { max-width: 680px; margin: 44px auto; padding: 0 24px 80px; }
h1    { font-family: 'Blackbird'; font-size: 1.6–2rem; letter-spacing: 0.01em; margin-bottom: 4px; }
h1 em { font-style: normal; color: var(--accent); }
.page-sub { color: var(--muted); font-size: 12px; margin-bottom: 32px; }
```

### Card-title (section header) pattern
```css
.card-title {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.14em; color: var(--muted);
  margin-bottom: 14px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
```

### Anti-patterns
- No emojis anywhere in the UI
- No border-radius above 6px
- No blue (#5b8dee) — accent is cyan #00b4d8 only
- Nav `<a>` tags: plain text, no uppercase, no button styling

---

## Phase 1: Add backend route

**File:** `backend_v2.js`

**Where:** Insert before the `express.static` catch-all at line 1224. Best insertion point is after the `/pricing` route block — search for `GET /pricing` comment to find it.

**What to add:**
```js
/**
 * GET /about
 * Public about page — no auth required
 */
app.get('/about', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});
```

**Verification:**
- `node --check backend_v2.js` passes with no syntax errors
- `grep -n "GET /about" backend_v2.js` returns the new comment line
- No existing `/about` route conflict: `grep -n "app.get.*'/about'" backend_v2.js` should return exactly 1 result after the edit

---

## Phase 2: Create `public/about.html`

Create the file from scratch. Use the full page template below. **Leave the personal content sections as clearly marked placeholders** — the user will fill them in.

**File:** `public/about.html`

**Structure (4 cards):**
1. **What is akFISHinfo** — product description card
2. **Who it's for** — target audience card
3. **How it works** — pipeline step-by-step (ADF&G email → PDF → Claude parser → SMS)
4. **The team** — origin story / fisherman background

**Full template:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About — akFISHinfo</title>
  <style>
    @font-face {
      font-family: 'Blackbird';
      src: url('/static/projekt-blackbird-v2.otf') format('opentype');
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #060a0f;
      --surface: #0d1520;
      --border:  #1a2d3f;
      --text:    #dde8f4;
      --muted:   #5a7288;
      --accent:  #00b4d8;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
      font-size: 14px;
      min-height: 100vh;
    }
    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 22px; height: 50px;
      background: rgba(6,10,15,0.95);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 100;
    }
    .wordmark {
      font-family: 'Blackbird', sans-serif;
      font-size: 19px; letter-spacing: 0.03em;
      color: var(--text); user-select: none;
    }
    .wordmark em { font-style: normal; color: var(--accent); }
    .nav-links { display: flex; gap: 18px; align-items: center; }
    .nav-link {
      color: var(--muted); text-decoration: none;
      font-size: 12px; font-weight: 500; transition: color 0.15s;
    }
    .nav-link:hover { color: var(--text); }
    .nav-link.active { color: var(--text); }

    .page {
      max-width: 680px;
      margin: 44px auto;
      padding: 0 24px 80px;
    }
    h1 {
      font-family: 'Blackbird', sans-serif;
      font-size: 2rem; letter-spacing: 0.01em;
      margin-bottom: 6px;
    }
    h1 em { font-style: normal; color: var(--accent); }
    .page-sub { color: var(--muted); font-size: 13px; margin-bottom: 36px; line-height: 1.6; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 20px 22px;
      margin-bottom: 14px;
    }
    .card-title {
      font-size: 9px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.14em;
      color: var(--muted);
      margin-bottom: 14px; padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .card p {
      color: var(--text); font-size: 13px;
      line-height: 1.7; margin-bottom: 10px;
    }
    .card p:last-child { margin-bottom: 0; }

    /* Pipeline steps */
    .pipeline { display: flex; flex-direction: column; gap: 0; }
    .pipeline-step {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 12px 0;
      border-bottom: 1px solid rgba(26,45,63,0.5);
    }
    .pipeline-step:last-child { border-bottom: none; padding-bottom: 0; }
    .step-num {
      width: 22px; height: 22px;
      background: rgba(0,180,216,0.12);
      border: 1px solid rgba(0,180,216,0.25);
      border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800; color: var(--accent);
      flex-shrink: 0; margin-top: 1px;
    }
    .step-body { flex: 1; }
    .step-label {
      font-size: 12px; font-weight: 700;
      color: var(--text); margin-bottom: 3px;
    }
    .step-desc { font-size: 12px; color: var(--muted); line-height: 1.55; }

    .cta-row { margin-top: 32px; display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      display: inline-block; padding: 9px 18px;
      border-radius: 4px; font-size: 11px; font-weight: 700;
      letter-spacing: 0.05em; text-transform: uppercase;
      text-decoration: none; transition: opacity 0.15s;
      cursor: pointer; border: none; font-family: inherit;
    }
    .btn:hover { opacity: 0.82; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-ghost   { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  </style>
</head>
<body>

<nav>
  <a href="/" style="text-decoration:none">
    <div class="wordmark">akFISH<em>info.</em></div>
  </a>
  <div class="nav-links">
    <a href="/app"         class="nav-link">map</a>
    <a href="/about"       class="nav-link active">about</a>
    <a href="/account"     class="nav-link" id="account-link" style="display:none">account</a>
    <a href="/auth/logout" class="nav-link" id="logout-link"  style="display:none">sign out</a>
    <a href="/login"       class="nav-link" id="login-link">sign in</a>
  </div>
</nav>

<div class="page">
  <h1>About <em>akFISHinfo.</em></h1>
  <p class="page-sub">Real-time commercial salmon opening alerts for Prince William Sound.</p>

  <!-- Card 1: What it does -->
  <div class="card">
    <div class="card-title">What it is</div>
    <!-- PLACEHOLDER: Write 2–3 sentences describing the product.
         Example structure: what problem it solves, what it delivers, and how fast.
         E.g.: "akFISHinfo monitors ADF&G for Prince William Sound opening announcements
         and sends you an SMS the moment one is issued — before you'd hear it any other way." -->
    <p>[FILL IN: Product description — what akFISHinfo does and why it matters.]</p>
  </div>

  <!-- Card 2: Who it's for -->
  <div class="card">
    <div class="card-title">Who it's for</div>
    <!-- PLACEHOLDER: Describe the target user. Commercial salmon fishermen in PWS.
         Include any specifics: permit holders, tender operators, crew, etc.
         Mention the districts covered (Eastern, Northern, Southeastern, etc.) -->
    <p>[FILL IN: Target audience — who benefits and what districts are covered.]</p>
  </div>

  <!-- Card 3: How it works -->
  <div class="card">
    <div class="card-title">How it works</div>
    <div class="pipeline">
      <div class="pipeline-step">
        <div class="step-num">1</div>
        <div class="step-body">
          <div class="step-label">ADF&amp;G issues an announcement</div>
          <div class="step-desc">Alaska Department of Fish &amp; Game emails a PDF opening announcement to a monitored inbox.</div>
        </div>
      </div>
      <div class="pipeline-step">
        <div class="step-num">2</div>
        <div class="step-body">
          <div class="step-label">PDF is parsed automatically</div>
          <div class="step-desc">The attachment is processed by an AI parser that extracts district names, gear types, open/close windows, and any special constraints.</div>
        </div>
      </div>
      <div class="pipeline-step">
        <div class="step-num">3</div>
        <div class="step-body">
          <div class="step-label">Map updates instantly</div>
          <div class="step-desc">The interactive district map reflects the current opening status for all 11 PWS districts in real time.</div>
        </div>
      </div>
      <div class="pipeline-step">
        <div class="step-num">4</div>
        <div class="step-body">
          <div class="step-label">SMS alert goes out</div>
          <div class="step-desc">Pro subscribers receive a text message immediately — no refreshing, no checking, no delays.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Card 4: Team / origin story -->
  <div class="card">
    <div class="card-title">The team</div>
    <!-- PLACEHOLDER: Write the origin story in first person.
         Cover: your background as a fisherman, the frustration that led to building this,
         who else is involved (if anyone), and what you're trying to accomplish.
         Keep it honest and direct — fishermen will see through marketing fluff. -->
    <p>[FILL IN: Who built this, why, and your personal connection to PWS commercial fishing.]</p>
  </div>

  <div class="cta-row">
    <a href="/login" class="btn btn-primary" id="cta-btn">Get started</a>
    <a href="/"      class="btn btn-ghost">Back to map</a>
  </div>
</div>

<script>
  // Swap nav and CTA based on auth state
  fetch('/api/me').then(r => r.json()).then(({ user }) => {
    if (user) {
      document.getElementById('login-link').style.display   = 'none';
      document.getElementById('account-link').style.display = '';
      document.getElementById('logout-link').style.display  = '';
      document.getElementById('cta-btn').href = user.has_access ? '/app' : '/pricing';
      document.getElementById('cta-btn').textContent = 'Open app';
    }
  });
</script>

</body>
</html>
```

**Verification:**
- File exists: `ls public/about.html`
- No emojis: `grep -n "emoji\|[^\x00-\x7F]" public/about.html` — should return nothing
- No blue accent: `grep -n "#5b8dee\|Helvetica\|#0f1117" public/about.html` — should return nothing
- Font face present: `grep -n "Blackbird" public/about.html` — should return 2+ lines

---

## Phase 3: Add "about" link to all nav bars

Update three files to include an "about" nav link. Pattern: insert `<a href="/about" class="nav-link">about</a>` into the `.nav-links` div (or topbar-right on app.html). Do NOT mark it `active` on pages other than about.html.

### 3a. `public/index.html` (landing page)

The landing page nav is different — it has "sign in" / "open app" links dynamically swapped by JS. Find the nav section (lines ~315–323) and add a static "about" link that is always visible.

Locate this block:
```html
<nav>
  <div class="wordmark">akFISH<em>info.</em></div>
  <!-- ... sign in / open app links ... -->
</nav>
```

Add `<a href="/about" class="nav-link" style="margin-right: auto; margin-left: 18px;">about</a>` between the wordmark and the auth links, OR append it at the end of the nav-links group. Match the existing `.nav-link` styling already defined in index.html's `<style>` block.

### 3b. `public/account.html` (lines 221–226)

Current nav-links:
```html
<a href="/app"         class="nav-link">map</a>
<a href="/account"     class="nav-link active">account</a>
<a href="/auth/logout" class="nav-link">sign out</a>
```

Add `<a href="/about" class="nav-link">about</a>` between "map" and "account".

### 3c. `public/app.html` (topbar-right, line ~589)

The app topbar uses `#topbar-right` with dynamically shown links. Add a static about link that is always visible:
```html
<a href="/about" class="nav-link">about</a>
```
Insert it before or after `#account-link`.

### 3d. `public/pricing.html` and `public/setup.html`

These pages have minimal navs (just sign out / no nav links). Add "about" only if there's a nav-links group present. `pricing.html` has only a sign-out link — add "about" before it:
```html
<a href="/about" class="nav-link">about</a>
<a href="/auth/logout" class="nav-link">sign out</a>
```

**Verification:**
- `grep -rn 'href="/about"' public/` — should return results in all 5 files

---

## Phase 4: Fill in personal content

**This phase is for the user, not an LLM.**

Open `public/about.html` and replace the four `[FILL IN: ...]` placeholder paragraphs with real content:

1. **What it is** — 2–3 sentences on what akFISHinfo does
2. **Who it's for** — describe the target fisherman; mention PWS districts
3. *(How it works is already written — review for accuracy)*
4. **The team** — your story: fisherman background, why you built it, who's involved

After filling in content, review the pipeline steps (card 3) for accuracy against the real system. The current text is accurate based on the codebase but may need rewording to match your preferred framing.

---

## Final: Verification checklist

Run all of these before committing:

```bash
# 1. Syntax check backend
node --check backend_v2.js

# 2. Route present
grep -n "GET /about" backend_v2.js

# 3. about.html exists and has no old tokens
ls public/about.html
grep -n "#5b8dee\|Helvetica\|emoji" public/about.html

# 4. All nav bars link to /about
grep -rn 'href="/about"' public/

# 5. CLAUDE.md route table — add /about row manually
grep -n "/about" CLAUDE.md
```

Then update `CLAUDE.md` — add a row to the Public pages table:
```
| `/about` | `public/about.html` | none |
```

Commit message template:
```
Add /about page with pipeline explainer and origin story

- New GET /about route in backend_v2.js
- public/about.html: 4-section page (what/who/how/team)
- Nav link added to index, app, account, pricing, setup pages
- Pipeline steps reflect actual ADF&G → PDF → Claude → SMS flow
```
