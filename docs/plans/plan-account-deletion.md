# Plan: Account Deletion

**Goal:** Add a self-service "Delete account" flow to akFISHinfo so the Privacy Policy's
promise ("email us and we'll delete within 30 days") can eventually be replaced with
an in-app button. Immediate scope: button in `account.html` → `DELETE /api/account`
endpoint → cancel Stripe subscription → delete `captains` row → log out session → redirect `/`.

> **Scope limit:** No new DB migrations needed. `DELETE FROM captains WHERE id = $1`
> will cascade to `user_sessions` (Passport's session store). `sms_log` stores phone
> number + message text but has no FK to captains — retained per Privacy Policy's 90-day
> retention policy, which is acceptable. No other tables reference captains by FK.

---

## Phase 0: Findings (gathered before writing this plan)

### Auth guard pattern (backend_v2.js:1175)
```js
if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
```

### db.query pattern (backend_v2.js:1204)
```js
await db.query(`UPDATE captains SET ...`, vals);
```

### Logout pattern (backend_v2.js:227–232)
```js
req.logout(err => {
  if (err) return next(err);
  res.redirect('/');
});
```
For the deletion endpoint we call `req.logout` then respond with JSON (not redirect),
so the client can handle the redirect after confirming success.

### Stripe subscription_id column (backend_v2.js:572)
`captains.stripe_subscription_id VARCHAR(255)` — may be NULL for trial/free users.

### Stripe SDK usage
Only `stripe.checkout.sessions.create` is used today. `stripe.subscriptions.cancel(id)`
is the correct method to cancel an active subscription — it accepts the subscription ID
string directly and cancels immediately by default.

### account.html insertion point
Last card closes at line 302 (`</div>`). Outer `</div>` (`.page`) at line 303.
New "Danger Zone" card inserts between lines 302 and 303.

### No existing delete UI or endpoint — clean slate.

---

## Phase 1: Backend — `DELETE /api/account`

**File:** `backend_v2.js`
**Insert after:** `PATCH /api/account` handler (ends ~line 1210)

```js
/**
 * DELETE /api/account
 * Permanently deletes the authenticated user's account.
 * Cancels active Stripe subscription first, then removes the captains row.
 * Session is destroyed after deletion.
 */
app.delete('/api/account', express.json(), async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });

  // 1. Cancel Stripe subscription if one exists
  if (req.user.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(req.user.stripe_subscription_id);
    } catch (e) {
      // Log but do not block deletion — subscription may already be canceled
      console.error('⚠️  Stripe cancel error during account deletion:', e.message);
    }
  }

  // 2. Delete captains row — cascades to user_sessions
  await db.query('DELETE FROM captains WHERE id = $1', [req.user.id]);

  // 3. Destroy Passport session and respond
  req.logout(err => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});
```

**Verification:**
```bash
grep -n "DELETE /api/account" backend_v2.js
# → should find the new route
```

---

## Phase 2: Frontend — Danger Zone card in `account.html`

**File:** `public/account.html`
**Insert:** After the last existing card (Session card, ~line 302), before `</div>` (`.page`)

### 2.1 Add CSS (inside `<style>`)

Append inside the existing `<style>` block:

```css
/* Danger zone */
.danger-title {
  font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.14em;
  color: #f87171;
  margin-bottom: 14px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(248,113,113,0.2);
}
.btn-danger {
  background: rgba(248,113,113,0.1);
  color: #f87171;
  border: 1px solid rgba(248,113,113,0.3);
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  cursor: pointer; transition: background 0.15s;
  font-family: inherit;
}
.btn-danger:hover { background: rgba(248,113,113,0.18); }

/* Confirmation modal */
.modal-backdrop {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 200;
  align-items: center; justify-content: center;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 24px 28px;
  max-width: 380px; width: 90%;
}
.modal h3 {
  font-size: 14px; font-weight: 700;
  color: #f87171; margin-bottom: 10px;
}
.modal p {
  font-size: 12px; color: var(--muted);
  line-height: 1.65; margin-bottom: 16px;
}
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn-cancel-modal {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 7px 14px;
  border-radius: 4px;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  cursor: pointer; font-family: inherit;
}
```

### 2.2 Add card HTML (before closing `</div>` of `.page`)

```html
<!-- Danger Zone -->
<div class="card" style="border-color: rgba(248,113,113,0.25);">
  <div class="danger-title">Danger Zone</div>
  <p style="font-size:12px;color:var(--muted);line-height:1.65;margin-bottom:14px;">
    Permanently deletes your account, cancels any active subscription,
    and removes your data. This cannot be undone.
  </p>
  <button class="btn-danger" onclick="openDeleteModal()">Delete account</button>
</div>

<!-- Confirmation modal -->
<div class="modal-backdrop" id="delete-modal">
  <div class="modal">
    <h3>Delete your account?</h3>
    <p>
      This will permanently delete your account and cancel your subscription.
      Any remaining paid time will be forfeited. This cannot be undone.
    </p>
    <div class="modal-actions">
      <button class="btn-cancel-modal" onclick="closeDeleteModal()">Cancel</button>
      <button class="btn-danger" id="confirm-delete-btn" onclick="confirmDelete()">Delete permanently</button>
    </div>
    <div id="delete-err" style="display:none;margin-top:12px;font-size:11px;color:#f87171;"></div>
  </div>
</div>
```

### 2.3 Add JS (inside existing `<script>` block)

```js
function openDeleteModal()  { document.getElementById('delete-modal').classList.add('open'); }
function closeDeleteModal() { document.getElementById('delete-modal').classList.remove('open'); }

async function confirmDelete() {
  const btn = document.getElementById('confirm-delete-btn');
  const err = document.getElementById('delete-err');
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  err.style.display = 'none';
  try {
    const r = await fetch('/api/account', { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) {
      window.location.href = '/';
    } else {
      err.textContent = d.error || 'Something went wrong. Try again.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Delete permanently';
    }
  } catch {
    err.textContent = 'Network error. Try again.';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Delete permanently';
  }
}
```

**Verification:**
```bash
grep -n "Delete account\|deleteModal\|confirmDelete" public/account.html
# → should find all three
```

---

## Phase 3: Verification checklist

```bash
# Route present
grep -n "DELETE /api/account" backend_v2.js

# Files updated
grep -n "danger-title\|btn-danger\|deleteModal" public/account.html

# Stripe cancel not using wrong method name
grep -n "subscriptions.cancel\|subscriptions.del" backend_v2.js
# → should show subscriptions.cancel, not subscriptions.del (deprecated)

# sms_log does NOT have captains FK (confirm no cascade needed)
grep -n "sms_log\|REFERENCES captains" backend_v2.js
```

Manual test flow:
1. Create a test account (email/password)
2. Navigate to /account → verify "Danger Zone" card appears
3. Click "Delete account" → confirm modal appears
4. Click "Delete permanently" → verify redirect to `/`
5. Attempt to log in with deleted credentials → verify login fails
6. (If test Stripe subscription exists) verify subscription canceled in Stripe dashboard

---

## Commit message template
```
Add account self-deletion — DELETE /api/account + Danger Zone UI

- Cancels Stripe subscription before removing captains row
- Session destroyed on deletion; user redirected to /
- Fulfills Privacy Policy deletion promise with in-app flow
```
