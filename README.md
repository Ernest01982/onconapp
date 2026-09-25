# FieldFlow

### Open the client's WhatsApp (v20)

Open a client → **Open client’s WhatsApp**, or select the client in **Send price-list PDF** and tap **Open [client] on WhatsApp**. This uses that client's saved Phone field—not the rep's number. The PDF panel shows the selected client and international number first. South African `082…` numbers become `+2782…` for the link only; saved data is unchanged. For other countries, save a full `+country-code` number. Missing/ambiguous numbers are blocked; edit the client's Phone field to correct them.

The chat uses a normal same-tab link, not a popup. If WhatsApp shows a web page, tap **Continue to Chat / Open WhatsApp** there. Use Back to return to FieldFlow. A local save error blocks leaving; keep FieldFlow open and use the recovery controls first. Never clear browser storage to troubleshoot this.

To send the actual PDF to that exact number: **Download PDF → Open client’s WhatsApp → attach the downloaded PDF as a Document → Send**. Opening the chat alone does not attach or send anything. The alternative **Share PDF — choose WhatsApp recipient** includes the file through the phone's share menu, but still requires choosing the chat manually. The recipient must have an active WhatsApp account. See [WhatsApp's official click-to-chat guidance](https://faq.whatsapp.com/5913398998672934).

### Save a client to phone contacts (v18)

When adding a client, tick **Also save to phone contacts**. This also works with **Start visit → Add new client**. After the client is saved, tap **Download contact file**, open the downloaded `.vcf` file, choose Contacts and confirm Save. Existing clients offer **Save to phone contacts** in their details.

The file includes the venue, person, role, phone and email, not private CRM notes. It is a one-off copy: later edits in FieldFlow do not update your phone automatically. Check existing phone contacts before importing again to avoid duplicates. Cancelling the import does not remove the FieldFlow client or active visit. No address-book permission or database change is required.

### Send the actual PDF through WhatsApp (v18)

Open a client → **Send price-list PDF** (or Price List → Send PDF) → **Share PDF — choose WhatsApp recipient**. In your phone's sharing menu choose WhatsApp or WhatsApp Business, select the recipient, check the PDF and confirm Send. This file-sharing option cannot preselect the chat or verify delivery. To open the saved client's exact number instead, use the direct-chat workflow above. The email-sharing option remains available.

Implementation references: [Web Share file handoff and device-dependent destinations](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [vCard 3.0 contact format](https://www.rfc-editor.org/rfc/rfc2426).

### Listing-date and reporting repairs (v18)

A visit can be saved when the buyer does not yet know the next menu/listing date, including the “Not doing listings now” outcome. To ask again later, tap **Date unknown — ask again later**, choose a follow-up date and review the reason/contact. It creates a normal linked follow-up, not an invented listing window. Existing details are kept.

Windows more than 30 days past their saved target remain under **Activity → Listing windows → Needs review**. Open **Review cycle → Edit cycle** to save the next known date. Past visit snapshots are not changed. Reviews are not counted as open buying opportunities; these are in-app reminders, not push notifications.

Reports and email summaries retain minute precision. Activity/travel use the selected period; current pipeline, active listings and listing windows are labelled Current. Ever listed is an all-history figure, not period conversion. Completed follow-ups without a valid completion date remain in history but are explicitly excluded from period completion totals. This release uses existing fields and requires no database migration.

### Email follow-up (v15)

Open a client or a visit → Email Follow-up. The configured email app opens with recipient, subject and contextual message. Choose the work sending account in Outlook, review/edit the draft and send manually. Return to FieldFlow → Mark Email as Sent to record your confirmation once. Pending confirmation is available on Today and Activity after a reload.

No Outlook password or mail-service credentials are stored. No SMTP, Graph or backend sending is used. Mailto cannot force Outlook, set the From account, verify delivery or attach a PDF. Long drafts offer a full-message copy/paste fallback. Use the separate Send price-list PDF workflow for attachments.

The additive email_follow_up_history migration is applied on OnconApp. It adds customers.email_follow_ups (JSONB) under existing client RLS. Apply this migration before deploying to another database.

### Sending the supplier PDF

Open a client → Send price-list PDF, or Price List → Send PDF. Copy the client email if needed, tap Share PDF attachment, choose Outlook, select/paste the recipient and send there. The original complete seven-page August PDF is attached, regardless of catalogue filters. Browser/device support varies.

If native file sharing is unavailable, Download PDF, open the email draft and attach the downloaded file manually. The app cannot confirm delivery. The public supplier PDF is cached for offline access after a successful online app installation/update; email delivery still needs connectivity.

FieldFlow is a working, mobile-first field sales CRM prototype designed for a Samsung Ultra-sized screen. It is local-first and can securely back up and sync each signed-in user's CRM data through Supabase.

## Run it

1. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:4173` in a browser.
5. On Android, use the browser menu’s **Add to Home screen** option to test the installed PWA experience.

For the pilot cloud account, create the intended user in **Supabase Dashboard → Authentication → Users → Add user**. Keep public signup disabled in the project's Auth settings; the app intentionally provides sign-in only. Guest capture remains available before cloud access is configured.

## Install on a Samsung phone

1. Open `https://ernest01982.github.io/onconapp/` in Google Chrome. On current Samsung devices, use Chrome for installation; Samsung Internet may generate an outdated Android package that Play Protect blocks.
2. Tap **Install** in the FieldFlow card on the Today screen. If the browser does not show the native prompt yet, the app displays the exact browser-menu steps.
3. Confirm **Install** or **Add to Home screen**.
4. Open FieldFlow from the phone’s Apps or Home screen. The pilot works immediately on the device; use the profile button to sign in with an invited account when cloud backup is enabled.

The production site is served over HTTPS and includes a service worker, 192×192 and 512×512 Android icons, a maskable icon, standalone display mode and an offline app shell.

The app starts with an empty CRM and the imported Niew Beverages On Con catalogue effective 1 August 2026 (292 current products). Seven older Vinette records are retained as inactive for historical links, not included in current prices. Catalogue updates preserve existing IDs and refresh saved-device and restored prices on load. Add real clients as you begin testing; no fictional customers, visits or follow-ups are included.

## What works

- One-tap location-assisted **Start visit** and **End visit**
- Add never-visited clients and edit venue, contact and opportunity details
- Pin an unlocated client automatically on the first visit or manually from its profile
- Device GPS mileage tracking with start/stop controls, plus manual and odometer-based trip capture
- Nearest-client detection and per-client location pinning from the device
- Automatic distance and reimbursement totals at R4.90 per kilometre
- Live visit timer and device-local capture
- Complete visit records with place/contact details, feedback outcome, next action, wine interest and samples left
- Voice input where browser speech recognition is available, with a typed fallback
- Local note structuring into summary, products, outcome, next action and follow-up date
- Follow-up creation, reason/contact capture, completion, rescheduling history and overdue/today/upcoming views
- Separate menu/listing-cycle reminders using an exact date or month and configurable 30/60/90-day notice
- Priority buying-window cards on Today and Activity, plus integrated management-report metrics
- Customer/contact records, opportunities and recent visit history
- A single master-wine relationship per restaurant and wine, with Interested, Sampled, Considering, Listed, Delisted and Not Interested status history
- Visit wine outcomes that update the restaurant's existing wine pipeline without creating duplicates
- Two-way listing views: wines at a restaurant and restaurants listing or considering a wine
- Search and quick filters across customers, visits, wine listings, follow-ups and products
- Imported Niew Beverages catalogue with 95 items across 8 suppliers/categories
- Search by product, alias or barcode; case/unit and tax-inclusive/exclusive pricing
- Supplier-filtered, email-ready price-list sharing
- Daily, weekly, monthly and custom-range management reports covering activity, pipeline, confirmed listings and travel
- Filterable, printable KM reports and CSV export with business-purpose and odometer fields
- Full JSON backup and restore with a safety backup before import
- A local assistant that answers common planning and customer-history questions
- Service-worker caching and local-first persistence for offline-safe capture
- Invitation-only email/password sign-in for the single-user pilot
- Secure Supabase backup and cross-device sync protected by per-user Row Level Security

## Prototype boundaries

The app saves to the browser immediately and works without an account. Guest data and each signed-in user's data are stored in separate device workspaces, and signing out locks the account workspace. When a user signs in, normalized customer, visit, task, product, restaurant-wine relationship and travel records sync to Supabase. Listing-window reminders are calculated locally and appear when FieldFlow is opened; push notifications are a later Android/service integration. Its “AI” note extraction and assistant are intentionally deterministic for now so the core workflow can be tested without an AI API key. The price-list and report buttons prepare an email through the device’s configured mail app; direct Microsoft 365 sending is an integration step described in [PRODUCT-NOTES.md](PRODUCT-NOTES.md).

The PWA uses the device’s native browser location permission. Keep the app open while recording a trip because browsers can pause foreground GPS when the screen is locked. The commercial native Android stage uses a foreground location service for reliable, visible background mileage capture.

Version 11 retains full visit notes, appends voice input, supports note/outcome corrections, and uses version-checked row writes with manual device/cloud conflict review. Update every device to v11 before resuming work. Bulk cloud reset is deliberately disabled to prevent cascading loss of linked history.

Before production use, add server-side AI, consent/audit controls, and production Google/Microsoft integrations. Supabase Auth, the Postgres database, ownership policies and additive relationship/travel schema are now in place.

## Files

- `index.html` — installable app entry point
- `styles.css` — responsive, touch-first visual system
- `app.js` — data, views and working interaction flows
- `cloud.js` — Supabase authentication and local-first synchronization
- `domain.js` — relationship, follow-up, reporting-date and odometer business rules
- `supabase/migrations` — versioned database schema and RLS policies
- `public/manifest.json` and `public/sw.js` — PWA installation and offline cache
- `package.json` — pinned app dependencies and development/build scripts
- `PRODUCT-NOTES.md` — assumptions, data model, workflows and evolution path


Full notes are limited to 4,000 characters; older summaries cannot reconstruct notes that were already discarded. Browser storage can still be removed by device cleanup, so keep exported backups. Physical-phone microphone and signed-in two-device testing remain release acceptance checks.
