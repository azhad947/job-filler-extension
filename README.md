# Job Application Autofill

A Chrome extension that saves your info once and fills it into job application
forms on any company's career page, using simple label/name/placeholder
matching (no AI calls, everything stays on your machine).

## Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`job-form-autofill-extension`)
5. Pin the extension icon for easy access

## Use it

1. Click the extension icon, fill in the **Profile** sections, click **Save profile**
   (stored locally via `chrome.storage.local` — never leaves your browser)
2. Go to any job application page
3. Click the extension icon → **Fill this page**
4. Filled fields flash green; anything the extension couldn't match is left alone

## How matching works (`content.js`)

For every `input`, `textarea`, and `select` on the page, it collects the
associated `<label>`, `aria-label`, `placeholder`, `name`, and `id`, then
checks that text against an ordered list of keyword rules (e.g. `"first
name"`, `"linkedin"`, `"current company"`). The most specific rules are
checked before generic ones so a "First Name" field is never mis-matched as
just "Name".

Values are set via the native `<input>` value setter (not just
`el.value = ...`) and dispatch real `input`/`change` events afterward, so
React/Vue/Angular-driven career sites (Greenhouse, Lever, Workday, etc.)
actually pick up the change instead of showing a stale/empty field.

## AI fill (optional, via Gemini)

Rule-based matching handles clearly-labeled standard fields for free and
instantly. For everything left over — fields worded differently on every
company's form ("Do you require visa sponsorship?", "Desired salary",
"How did you hear about us?", open-ended "Why do you want to work here?")
— you can turn on an AI fallback pass:

1. Get a free API key at **aistudio.google.com/apikey**
2. In the popup, open **AI fill**, check **Use AI for fields the matcher
   can't handle**, and paste your key
3. (Optional) Leave **Model** blank to use the default
   (`gemini-2.0-flash`), or type a different model name if you have access
   to one you prefer
4. Fill in **Professional summary** — a short bio the AI can draw on for
   open-ended questions

### How it works

- `content.js` runs the rule-based pass first, then collects whatever's
  left (label text, field type, and the list of options for any select or
  radio group) and sends *only that* — plus your saved profile — to
  `background.js`
- `background.js` calls `models/{model}:generateContent` on
  `generativelanguage.googleapis.com` directly from your browser, with a
  prompt that explicitly tells the model to only use facts present in your
  profile (never invent employers, dates, or numbers) and, for any select
  or radio field, to return one of the existing option strings verbatim —
  never a made-up option
- Answers come back mapped to field indices and get filled the same way
  as the rule-based pass

### Cost, privacy, and limits

- Your Gemini API key is stored only in `chrome.storage.local` on your
  machine — it is never sent anywhere except directly to Google's API
- API usage is billed to your own Google AI Studio account under whatever
  free tier / pricing applies to the model you choose
- At most 40 leftover fields are sent per page (`MAX_AI_CANDIDATES` in
  `content.js`) to keep requests small
- Because it's a live API call, AI-filled fields take a second or two
  longer to appear than the instant rule-based fields
- As with the rule-based pass, file/resume uploads are still never
  touched — that's a hard browser restriction, not a matching problem

## Known limitations

- **File uploads (resume/cover letter attachments)** can't be filled by any
  browser extension — browsers block scripts from setting a file input's
  value, for security reasons. The extension detects these fields and tells
  you how many it skipped so you know to attach them by hand.
- **Long free-text questions** ("Why do you want to work here?", cover letter
  text boxes) are intentionally left blank — matching is keyword-based, not
  AI-based, so it only fills clearly-labeled structured fields.
- **CAPTCHAs and multi-step wizards** aren't handled specially — fill each
  visible step, then click through.
- Extremely custom form widgets (e.g. a date picker built from three separate
  unlabeled `div`s) may not match; the extension only targets real form
  elements (`input`, `textarea`, `select`).

## Extending it

- Add more fields: add an `<input>` to `popup.html`, its `id` to `FIELD_IDS`
  in `popup.js`, and a matching rule in `FIELD_RULES` in `content.js`.
- Multiple profiles (e.g. different resumes per role type): swap the single
  `profile` key in storage for a dictionary of named profiles and add a
  picker to the popup.
