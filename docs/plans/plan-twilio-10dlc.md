# Plan: Twilio Toll-Free Messaging Verification (10DLC)

Screenshot captured: Step 2/2 — Messaging use case.
Step 1/2 was not in the screenshot — see note at bottom.

---

## Step 2/2 — Field-by-field

---

### Estimated monthly volume *(required, dropdown)*

Select: **1,000 – 10,000**

At launch you'll be well under this, but selecting the lowest tier (under 1,000) can trigger additional scrutiny and looks like a test account. 1,000–10,000 is the honest range for a growing seasonal service and is standard for small SaaS.

---

### Opt-in type *(required, dropdown)*

Select: **Website opt-in**

Users provide their phone number on `/setup` and check an explicit SMS consent checkbox before submitting. That is a textbook website opt-in.

---

### Messaging use case categories *(required)*

```
Notifications / Alerts
```

Do not use "Marketing" — this is purely transactional alert delivery. Carriers treat those differently and "Marketing" invites more scrutiny.

---

### Proof of consent (opt-in) collected *(required — URL of website or document)*

```
https://akfishinfo.com/setup
```

This is the page where users enter their phone number and check the SMS consent checkbox. It is the actual point of opt-in capture. If Twilio asks for a screenshot or backup, the setup page is the evidence.

---

### Use case description *(required)*

```
akFISHinfo sends SMS alerts to Alaska commercial salmon fishermen when ADF&G issues Prince William Sound district opening announcements. Subscribers opt in via explicit SMS consent checkbox at akfishinfo.com/setup. Messages are transactional alerts parsed from official ADF&G PDFs — no marketing. Frequency: 0–10 msgs/week during fishing season (May–Sept), none off-season. Users opt out via STOP reply or account cancellation.
```
*(424 characters)*

Keep it factual and specific. Mention ADF&G by full name — government agency tie-in signals legitimacy.

---

### Sample message *(required)*

```
ADF&G ALERT — Districts 6 & 7 open for pink salmon — Sat Aug 2 8AM to Mon Aug 4 8PM AKDT. Verify at akfishinfo.com before deploying gear. Reply STOP to opt out.
```

Rules for the sample message:
- Must include STOP opt-out language
- Must be realistic — use an actual district name, actual gear type
- Under 160 characters is ideal (one SMS segment)
- Do not use ALL CAPS for the whole message — just the prefix label is fine

---

### E-mail for notifications *(required)*

```
admin@akfishinfo.com
```

---

### Additional information *(optional)*

```
This service is used exclusively by Alaska commercial fishing license holders operating in Prince William Sound. All messages are triggered by official state agency (ADF&G) announcements — not marketing campaigns. Opt-in is captured via a double-action web form (phone entry + explicit consent checkbox). The service operates seasonally, May through September.
```

Using this field is worth it — it gives the reviewer context that this is a niche, legitimate, government-adjacent use case. Reviewers approve these faster when they understand the industry.

---

### Opt-in Confirmation Message *(optional — send this)*

```
You're subscribed to ADF&G opening alerts from akFISHinfo. Msg & data rates may apply. Reply STOP to unsubscribe, HELP for help.
```

Fill this in even though it's optional. It demonstrates you have a proper opt-in flow and reduces the chance of a rejection or callback.

---

### Help Message Sample *(optional — fill in)*

```
akFISHinfo: Commercial salmon opening alerts for Prince William Sound. Support: admin@akfishinfo.com. Reply STOP to unsubscribe.
```

---

### Privacy Policy URL *(optional — fill in)*

```
https://akfishinfo.com/privacy
```

---

### Terms and Conditions URL *(optional — fill in)*

```
https://akfishinfo.com/terms
```

---

### Opt-in image / screenshot URL *(optional — if present)*

If Twilio shows a field for uploading or linking to a screenshot of the opt-in form,
use a direct link to the registration page:

```
https://akfishinfo.com/login
```

**Note:** The SMS consent checkbox and phone field must be visible on this page
without requiring a prior account. See `plan-registration-opt-in.md` — the phone
capture and SMS consent checkbox should be moved onto the email/password registration
form in `login.html` so Twilio reviewers can see the actual opt-in UI without
creating an account. Until that is done, use the Privacy Policy URL as the
proof-of-consent reference instead.

The Privacy Policy page is live and references SMS delivery, Twilio, and opt-out rights explicitly. Having this URL here strengthens the submission significantly.

---

## Before submitting — pre-flight checklist

- [ ] STOP opt-out is wired in Twilio (or will be before SMS goes live — note this in Additional Information if not yet live)
- [ ] `/setup` page is live and shows the SMS consent checkbox (Twilio reviewers sometimes visit the proof-of-consent URL)
- [ ] `/privacy` page is live at akfishinfo.com/privacy
- [ ] `admin@akfishinfo.com` is receiving mail

---

## Step 1/2 — what was likely on that screen

Step 1/2 typically covers the business/brand profile:

| Field | What to enter |
|---|---|
| Business name | akFISHinfo |
| Business type | Sole Proprietor |
| Business address | 1274 Deer Valley Rd, Fairbanks, AK 99709 |
| Website | https://akfishinfo.com |
| Vertical / Industry | Agriculture / Fishing, or "Other — Commercial Fishing" |

If Twilio asks for an EIN: as a sole proprietor you can use your SSN, or register for a free EIN with the IRS (takes 5 minutes online) which avoids putting your SSN in a Twilio form.

---

## Notes on approval timeline

Toll-free verification typically takes **5–15 business days**. Submissions with complete optional fields (Additional Information, Opt-in Confirmation, Help Message, Privacy Policy URL) move faster than bare-minimum submissions. A rejection usually comes with a reason — common reasons are vague use case descriptions or missing proof-of-consent URL.
