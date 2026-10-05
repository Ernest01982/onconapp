# Changelog

## 2026-10-05 — v25: daily odometer and client navigation

- Travel & mileage now offers Start day / Finish day with date, start/end odometer, private KM, purpose, locations and notes. Open days persist offline and through sync; visits do not finish them or start GPS. Previous dates can be captured, but future dates and impossible readings are rejected.
- Business KM = end minus start minus private KM; reimbursement keeps the rate saved when the day started. Confirmation shows the calculation. Editing reuses the same day ID. Daily records represent date boundaries, not measured departure/arrival times; their cards say Start/End reading.
- Completed daily logs take priority over individual trips for the same South African date in Today, travel reports, management exports and assistant mileage totals. Supporting trips remain available and unchanged, but are not added to claims. Daily distance is not guessed per client. Daily private/total KM are included in CSV exports.
- Client details now offer Navigate · Google Maps using a saved pin or encoded address/area. Only the destination is sent, not CRM notes/contact details. Missing destinations and unsaved-work errors block navigation. This is an external Maps handoff, not an embedded map or background tracking.
- Added bounded daily_log JSON to travel_trips, without changing existing records, authentication or RLS. Active readings use the existing synced active-trip field. Historical fingerprints gain only the missing empty default. Live before/after verification found 0 trips, unchanged; no synthetic live CRM writes were made.
- Verification: 73 automated tests pass, including cloud readback for completed/open days, daily calculations, duplicate prevention, date boundaries and encoded navigation. Isolated 360/412/1280px workflows pass start/reopen, visit integration, invalid readings, finish/edit, CSV and no double-counting; screenshots reviewed. Production build passes. PWA cache v25.
- Limits: one odometer log per date for one vehicle; exclude private/non-business travel yourself. No automatic route distance, embedded map, background GPS or phone notifications added. Cloud verification on the actual phone still needs checking. Existing leaked-password-protection warning remains unchanged.

## 2026-09-29 — v24: daily reliability and audit repairs

- Added Today → Daily check: device versus last verified cloud totals/time, pending changes, manual backup-file confirmation, unfinished work, overdue tasks, suspect visit times, missing contacts/listing-cycle details and flagged GPS trips. Matching counts are not described as proof of matching contents.
- Matched trip precision to database storage for strict upload/readback verification (KM 3 decimals, rate/reimbursement 2, odometers 1). Zero reimbursement rates remain valid. Historical saved baselines gain only known missing defaults/precision; real competing changes remain conflicts.
- Added long/overnight visit warnings and explicit time correction with reason, confirmation, recovery backup download and retained original timestamps/audit history. Note-only edits preserve exact milliseconds. No real visit times were automatically changed.
- Stored visit location source/accuracy evidence. GPS trips flag background recording, signal loss and callback gaps; odometer review is recommended. This is not native background tracking.
- Added explicit primary/additional recipient selection across client, follow-up and PDF workflows. Missing additional details never fall back silently to the primary person. Added a quick follow-up to ask clients for unknown listing dates.
- Added complete CSV report download for Excel, with period activity, all current wine links, listing events, contact readiness, notes, time corrections and travel evidence; protected formula-like text. Removed six-row listing breakdown truncation. This is not the planned configurable XLSX manager report builder.
- Added mobile active-visit shortcuts, meaningful form labels, inert modal background, readable trade duration/year-aware dates, and mobile-fit sync-count table. Removed legacy demo cleanup based only on IDs c1–c5 so legitimate records are not discarded.
- Applied additive migration 20260929165047_visit_travel_reliability: bounded visit time_corrections/location_capture and trip recording_flags JSON fields. Before/after checksums confirm all preexisting fields in 56 visits and 0 trips unchanged. No changes to authentication, ownership, RLS or existing records.
- Tests: 69 automated tests and production build pass; isolated 360/412/1280px browser flows verify corrections, exact timestamp preservation, contact selection, denied GPS fallback, KM/reimbursement, CSV, backup and refresh persistence. Existing follow-up/PDF/email and client fields/sync recovery regression checks pass; offline supplier PDF share/download passes. No real CRM test writes or messages were sent.
- Known limits: the user's phone must still complete and confirm its own verified sync. Download confirmation is manual. Actual overnight times require the user's input. System sharing cannot confirm message delivery. Phone push notifications, native background GPS and manager roles remain separate upgrades. Existing Supabase leaked-password protection warning remains an administrator setting to resolve separately.

## 2026-09-29 — v23: Niew Beverages communication identity

- New contextual follow-up emails and follow-up message templates use Niew Beverages in subjects and signatures. Price-list sharing already uses Niew Beverages.
- Preserved user-edited/saved drafts, sent communication history, genuine Namaqua product names, supplier PDF and login details. Existing drafts can be edited before sending; no CRM migration or live record changes.
- Regression coverage checks company identity, recipient/encoding, preserved draft edits and genuine Namaqua wine names. PWA cache advanced to v23.

## 2026-09-29 — v22: historical sync comparison repair and clearer recovery

- Reproduced an older-version false customer conflict using the actual September 10 row shape: historical sync fingerprints lack email_follow_ups. The v21 compatibility upgrade added only the four new client columns, leaving an unchanged device record looking modified when the cloud copy had a newer edit.
- Extended only missing historical defaults with email_follow_ups: [] in current and interrupted-sync baselines. Existing history, values, timestamps/versions and invalid baselines remain untouched. No baseline is fabricated from current records; genuine competing edits still pause for explicit review.
- Today’s online sync warning now opens Profile & backup. Added a read-only exact error and Copy sync error with manual-selection fallback. Retry displays the actual error rather than assuming a connection problem. Local-save failure and offline indicators retain priority.
- Evidence: Supabase healthy; recent REST reads/authentication succeeded, with requests stopping around customer comparison and no failing write requests found. This is consistent with a client-side comparison stop, but the phone’s exact error/current workspace has not been supplied, so its specific cause and successful phone sync are not yet confirmed.
- Data safety: no live CRM writes, schema/auth/RLS changes, forced reconciliation or deletions. Read-only before/after checks retain 13 cloud clients, 22 visits, 9 tasks, 6 wine links and 0 trips with unchanged latest modification times. Existing downloaded backup was inspected read-only for metadata, not imported over any live workspace.
- Verification: 62 automated tests pass; production build passes. Isolated mocked-cloud browser test confirms old-baseline recovery without customer writes, retained visit note, true conflict protection, tappable warning, exact error copy/fallback, recovery backup, safe retry and both versions in review. New supplier/additional-contact mobile regression passes. No real account session or customer messages used in tests.
- Known limits: a genuine record conflict or a phone-specific error still requires its exact details/backup, not blanket device/cloud replacement. A separate GPS/reimbursement decimal-rounding mismatch was reproduced during investigation and remains a follow-up issue; it does not match the observed customer-stage stop. PWA cache advanced to v22.

## 2026-09-29 — v21: preferred supplier and optional additional contact

- Added optional Preferred supplier to client create/edit and Start Visit → Add new client. Added an expandable Additional contact section with independent name, phone and email fields. Partial details are allowed; existing values reopen visibly and can be corrected or cleared.
- Client details show supplier and a separate additional-contact card. Customer and Start Visit searches include the additional contact and supplier. Primary contact details and all existing email, WhatsApp, PDF and phone-contact export recipients remain unchanged; the extra contact is not a silent fallback.
- Customer forms retain typed values, checkbox choices and additional-section state through online/offline redraws. Invalid additional email opens its collapsed section for correction. Long supplier/contact values wrap on small screens.
- Added four empty-default text columns to customers with matching field-length limits. Applied and verified in Supabase: all 13 existing customer rows retain the identical preexisting-data checksum; IDs, historical fields, timestamps, RLS and policies were not changed. No live CRM test records or messages were created.
- Added both-way cloud mapping, field-level readback verification and backward-compatible defaults for old backups. Existing customer sync fingerprints gain only the historically absent empty fields, including interrupted-sync baselines; current local/cloud data is never used to fabricate a baseline. Actual competing edits still pause safely.
- Tests: 60 automated tests and production build pass. Isolated 360px, 412px and 1280px browser workflows pass legacy edits, blank/partial fields, correction/clearing, email validation, both searches, redraw persistence, Start Visit Back/reopen/reload, visit completion, backup export/import, unchanged primary recipients, and retained historical visits/tasks/KM. Synthetic cloud tests cover upload/readback, each field's verification failure, retries, clearing, remote-only edits and genuine conflicts. Existing follow-up/email/PDF regression passes at all three sizes. No runtime exceptions observed.
- Remaining scope: one additional contact per venue; choosing it as the PDF/WhatsApp recipient is not added. Full explicit cloud-workspace reload still closes open modals (existing behaviour). Security advisors show no new issue; the existing [disabled leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains. PWA cache advanced to v21.

## 2026-09-25 — v20: popup-free client WhatsApp handoff

- Replaced the unchecked popup launch with a real, same-tab WhatsApp link in client details and the PDF panel. The selected client and international number stay visible; the link is refreshed when the client changes and validated again on the tap. No private notes, message text or PDF link is added to the chat URL.
- Clarified the exact-recipient route: Download PDF → Open [client] on WhatsApp → paperclip / Document / Downloads → select the supplier PDF and Send. The separate native-share option still includes the actual file but requires manual recipient selection. Increased the numbered instructions' readability on small screens.
- Invalid/missing numbers cannot navigate. A local save failure or workspace conflict blocks leaving for WhatsApp; records and recovery controls stay available. Failed follow-up message saves now explicitly prevent default link navigation as well.
- No schema migration, account change, live CRM write, record rewrite or PDF replacement. Phone-contact export and existing email sharing remain unchanged. Offline cache advanced to v20.
- Verification: 56 automated tests and production build pass. Isolated browser checks at 360px, 412px and 1280px exercise real navigation intercepted before any WhatsApp request is transmitted (the old test only mocked window.open). Verified exact recipient, client switching, corrected numbers after reload, keyboard activation, no popups, no referrer/private payload, invalid-number blocking, unsaved-work navigation blocking, selection through offline redraw, unchanged 443064-byte supplier PDF hash, sharing/cancellation and unchanged CRM records. Mobile screenshots reviewed.
- Regression: follow-up notes/messages, email drafts, PDF file handoff, reschedule/completion/reopening and persistence pass at all three sizes. PDF download, cancellation, unsupported sharing, retry and offline access pass. No runtime exceptions in tested workflows; no real messages were sent.
- Remaining limit: this repairs the browser handoff, not WhatsApp's attachment interface. Opening the exact-number chat does not attach the PDF automatically. The phone must have WhatsApp available and that number must be registered; the native Samsung handoff and final send still require on-device verification.

## 2026-09-25 — v19: open the selected client's WhatsApp

- Added Open client’s WhatsApp to client details and the PDF panel. The PDF action reads the current selected client at the moment of the tap; it never defaults to the rep or another client. The panel shows the client name and resolved international number before opening the chat.
- Added conservative phone-format handling: South African local 10-digit numbers become +27; explicit +country-code/00 international numbers retain their digits. Missing, ambiguous, multi-number and malformed entries are blocked with guidance. Original saved phone values are not rewritten. Format validation does not prove that the number has a WhatsApp account.
- Prioritised Download PDF → Open client’s WhatsApp → attach as Document. This opens the correct saved-number chat without pretending the PDF is automatically attached or sent. Kept native PDF attachment sharing, now labelled Share PDF — choose WhatsApp recipient to make its manual-recipient selection clear. No text, private notes or links to the PDF are silently added to the direct-chat URL.
- No data migration, database write, account change or new service/API dependency. Bumped the offline cache to v19. Existing email and contact-file export remain unchanged.
- Verification: 56 automated tests pass; production build passes. Isolated Chrome workflows at 360px, 412px and 1280px verify exact outgoing chat URLs, client switching, number corrections/reload, international format, invalid/missing selection blocking, recipient preservation during offline/online redraw, unchanged original PDF hash, native PDF sharing/cancellation and no auto-completion or CRM mutation. Screenshots reviewed; no page overflow or runtime exceptions in the tested new workflows. Offline PDF download/share/fallback/retry regression passes. No actual WhatsApp chats, contacts or messages were opened/created in tests.
- Regression: existing follow-up messages, linked notes, email drafts, PDF file handoff, edit/reschedule, completion/reopening and reload persistence pass at 360px, 412px and 1280px. One concurrent browser run timed out waiting for an unchanged follow-up control; its isolated rerun passed without an app change.
- Limit: the direct chat requires an active WhatsApp number and the user's phone/app handoff. The user must attach the downloaded PDF in that chat and confirm Send; the browser cannot combine preselected recipient plus automatic file attachment through native sharing or confirm delivery.

## 2026-09-24 — v18: phone contacts, WhatsApp PDF sharing and audit repairs

- Added opt-in “Also save to phone contacts” to new/edit client forms, including the Start Visit client flow; the new-client draft preserves this choice when going Back. Existing clients also offer Save to phone contacts. A downloadable UTF-8 vCard contains only venue, contact person, role, phone and email. The client/active visit is saved before the contact-import instructions open. Import is confirmed in the phone Contacts app; there is no address-book access, automatic contact overwrite or ongoing phone-contact sync.
- Added Share PDF via WhatsApp to the existing PDF panel, alongside the unchanged email-sharing option. Both pass the actual original 443064-byte supplier PDF through native file sharing; the user chooses WhatsApp/WhatsApp Business and the chat. Added saved-phone display and copy, missing-number handling, and Download PDF → attach as Document instructions when sharing is unsupported. Cancellation never completes a task or marks an email/message as sent.
- Contacts/WhatsApp verification: 51 automated tests now pass, including Unicode, vCard field escaping/line folding, safe filenames, missing fields and no private-note leakage. Isolated browser tests at 360px, 412px and 1280px verify both client-entry paths, Back/draft preservation, exact downloaded contact fields, active-visit persistence, existing-client export without CRM changes, actual PDF file handoff, cancellation/denial, missing phone number and unsupported sharing. Existing follow-up and email/PDF handoff regression passes at all three sizes. Removed new-client/start-visit toast overlap when the contact instructions open.
- Phone-specific limit: importing the downloaded contact in Samsung Contacts and WhatsApp's native recipient/send screen need testing on the user's phone. The browser cannot force a share target, inspect the destination app, prevent duplicate phone imports, or verify delivery. No real contacts or messages were created during automated testing.

- Visits with “Not doing listings now / No current listing opportunity” can now save without a menu/listing date. Optional “Date unknown — ask again later” uses existing follow-up fields, keeps an existing reason/contact/next action, and requires the user to choose a follow-up date. It never invents a listing date or silently creates a task when follow-up is not selected.
- Listing windows older than the existing 31-day window remain in Activity → Listing windows → Needs review, with the original date visible. Today links to outstanding reviews; client details, reports and assistant answers distinguish them from open/approaching opportunities. Only an explicit client-cycle update changes the saved date; completed visit snapshots remain intact.
- Report and email time-in-trade totals now display minutes and hours/minutes (45 min; 1h 15m), not rounded whole hours. Period activity/travel, current pipeline/listings/windows, and all-history ever-listed percentages are explicitly labelled. Period completions use actual completion timestamps; undated historical completions are retained, excluded from period completion counts and clearly noted. Relisting/delisting totals count each relationship once per status within the selected period; no pipeline status counts as an active listing.
- Data/schema: no database migration, auth change, sync-protocol change or historical-record rewrite. Existing nullable dates and follow-up/visit/task links are reused and verified through the mocked cloud upload/readback workflow. No live CRM writes or real email sends during testing. PWA cache updated to v18.
- Verification: 47 automated tests pass; production build passes. Separate Chrome sessions at 360px, 412px and 1280px pass start/complete visit, unknown-date save, selected wine persistence, ask-again validation and linked task, reload, expired-window review/update, 45/75-minute report totals, Today/week/month/custom filters, actual completion dates, confirmed/current vs historical listing counts, assistant review and email-summary checks. Screenshots inspected; no horizontal page overflow or runtime exceptions in tested flows.
- Regression: follow-up messages, linked notes, edit/reschedule, completion/reopening and actual supplier-PDF file handoff pass at all three widths. PDF cancellation, fallback, retry, download and offline loading pass. Existing note/assistant/mileage checks pass on mobile/desktop. A separate copy of the supplied backup reopens with all 12 clients and 19 visits plus task/wine IDs, notes, links, travel and pending email preserved; source file hash unchanged. Malformed-workspace recovery remains safe.
- Known limits: listing reminders are still in-app, not push notifications. A historical completion date cannot be reconstructed reliably when missing. Wine/listing breakdown cards still show the top six entries. Samsung-native email handling and background GPS require on-device testing; manager/admin and Excel report design remain on hold.

## 2026-09-18 — v17: actionable follow-ups and Gmail handoff

- Follow-up titles now open an action screen on Today, Activity and client records. Shows the reason, contact person, wine, client contact/address, linked visit's original notes and next action; clearly labels a latest-visit fallback when there is no linked visit. Other clients' visits cannot be selected.
- Added editable message and subject, copy/share actions, reviewed email drafts, client/history access, preselected price-list PDF sharing, completion/reopening and existing rescheduling. Sharing never automatically completes a task or records an email as sent. Missing email leaves the message intact.
- Unfinished per-follow-up messages persist in the current device workspace and backup export, scoped by task and client. They are explicitly device-only, not cloud-synced. Save failures block navigation but allow copying the message. Pending email drafts are no longer regenerated over an existing draft when reopened.
- Email/PDF guidance now selects ernestreyneke@gmail.com in Gmail. This does not change the FieldFlow account, connect Gmail, or force the phone's default email app. Native file sharing passes the actual supplier PDF; mailto drafts have no attachment and are labelled accordingly.
- No database migration, account changes, record deletion or live CRM test writes. Existing record IDs and relationships are unchanged.
- Verification: 43 automated tests pass; isolated Chrome workflows at 360px, 412px and 1280px verify correct linked notes, message persistence, special characters, task context in drafts, missing-email handling, completion/reopening, rescheduling/editing, actual 443064-byte PDF handoff and no runtime exceptions. Existing email-history/idempotency regression passes on mobile/desktop. PDF cancellation, fallback, download, retry and offline tests pass against a static preview. Vite preview's development Vary headers caused an offline-cache mismatch, so offline verification used production-style static serving.
- Limitation: Gmail's compose screen, sender selection, attachment acceptance and delivery cannot be inspected through Web Share. Automatic verified Gmail drafts still need a Google Cloud OAuth client and the user's consent; no mailbox credentials or permissions were requested or stored. No real email was sent during testing.

## 2026-09-18 — v16: reliability and local recovery

- Corrected client-specific assistant questions: full client names scope last visits, follow-ups, listing windows and mileage; ambiguous/unknown last-visit clients request clarification rather than returning another client's visit.
- Notes-first active visit: removed visible speech controls, retained dormant speech implementation, and renamed the deterministic helper Organise my note. Drafts include selected master wines. Prose never auto-confirms listings or invents follow-up dates; explicit fields remain authoritative and original notes are retained.
- Home reimbursement now sums saved trip amounts, matching Travel and Reports even after a rate change.
- Device import requires backup download and explicit saved-file confirmation. Original guest bytes and an account-isolated recovery snapshot are retained; a separate guest storage pointer protects signed-out privacy. Original import backup can be downloaded from Profile & backup. No record IDs or CRM schemas changed.
- Unreadable/malformed local workspaces stop startup/sync with a recovery-download screen instead of being replaced by an empty workspace. Storage quota failures leave original import data intact.
- Cloud sync now reads all eight owned collections back and compares IDs, totals and mapped fields before showing Cloud verified and collection counts. Failed/interrupted verification restores prior merge baselines; retries do not duplicate records. Edits made during sync remain pending.
- Verification: 40 automated tests; isolated 412px mobile and 1280px desktop workflows; correct named-client answers, negative-note handling, selected wines, rate history and persistence; malformed-storage recovery download; reopened a COPY of the supplied 12-client/19-visit backup without changing original IDs, notes, relationships, travel or email draft. Mocked browser sign-in verified cancellation, backup download, retained source, readback totals and duplicate-free retries. Cancelled imports retain auth listeners and only prompt again on explicit retry. No live CRM writes used for testing.
- Limitations: helper remains rule-based, not a connected AI model. Browser download completion requires the user's confirmation. Recovery snapshots and unfinished email drafts remain device-only; keep external backups. Real Samsung background GPS, future notification support, reporting precision and broader accessibility work remain separate from this reliability pass.

## 2026-09-17 — v15: email follow-up drafts

- Added Email Follow-up in client, completed-visit and active-visit workflows. Uses encoded mailto only; no email API, passwords, SMTP or Microsoft authentication.
- Drafts use current recipient, contact name, visit date, master wine names, interest, existing listings, samples left, explicit sample promises in notes, next action and current follow-up date. Private notes are not copied wholesale. Closed listing windows receive non-pushy wording; past dates are not described as future promises.
- Missing/invalid email opens a clear validation panel with Add/edit contact email. Long mailto drafts are not silently truncated: copy the full message and open a recipient/subject-only draft.
- Pending confirmation is device-workspace-local and survives reload. Mark Email as Sent is explicit and idempotent by draft ID, records emailMarkedSent, markedAt, contact, venue and optional visit ID. It does not create visits/tasks or mark existing tasks complete.
- Added email history to the existing client record and Activity screen. Additive customers.email_follow_ups JSONB migration prepared; existing RLS/security policies remain unchanged. Cloud mapping and isolated round-trip test added.
- Verification: 35 automated tests passed, production build passed, isolated 412px mobile and 1280px desktop browser workflows passed with no runtime errors, no duplicate history and no duplicate visits/tasks.
- OnconApp resumed; email_follow_up_history migration applied and verified. Column default, size/array constraints and existing RLS confirmed. Security advisors report no new findings; the existing leaked-password-protection warning remains.
- Limitations: actual Samsung/Outlook launch needs the user's phone. Mailto cannot choose the sending account, prove delivery or attach the price-list PDF. Existing PDF-sharing workflow remains separate. Native email draft is editable in Outlook; history records manual confirmation, not exact final email content.

## 2026-09-17 — v14: share the original price-list PDF

- Added Send PDF on Price List and Send price-list PDF in client details. Shares the supplied seven-page supplier PDF unchanged, including when a product filter is active.
- Client chooser and copy-email control support Outlook recipient entry. Uses native file sharing after preloading, preserving the tap required by mobile browsers. Hand-off never claims email delivery.
- Download PDF and explicitly manual-attachment email draft are available when native sharing is unsupported or denied. Cancellation is non-destructive; failed downloads offer retry.
- Cached the PDF for offline access. Fixed duplicate relative/absolute URLs in the existing offline installer. Keep the PDF panel ready and selected client intact through connection-state redraws.
- No database migration, CRM changes, or demo records. The supplier PDF is a public static asset, like the existing public catalogue.
- Tests: 28 unit/regression tests; production build; original PDF SHA-256 match; isolated 412px browser tests for mocked attachment sharing, cancellation, denial, download, offline reload, client context, unsupported browser and retry. No runtime errors in passing workflow.
- Limits: actual Android-to-Outlook attachment hand-off requires phone testing. Native sharing cannot prefill a recipient reliably; copy/paste the client email and confirm Send in Outlook. Email draft fallback does not attach files automatically.
- Local preview note: Vite's Vary: Origin headers affect offline cache matching; offline checks pass on a production-style static server.

## 2026-09-17 — v13: August supplier price list

- Imported all 292 priced rows from NiewBev - On Con Price list 01.08.2026.xlsx, effective 1 August 2026, including 204 additions.
- Updated case/unit prices including and excluding VAT, pack sizes, barcodes and stock notices. Rounded each supplier price independently to cents; sundries display per-item pricing.
- Preserved all 95 existing product IDs, including the Namaqua Chenin Blanc alias correction to NAMCB01. Seven Vinette records absent from the new sheet remain inactive for history, excluded from current price lists; restaurant listing statuses are not changed.
- Added idempotent catalogue refresh on local load, backup restore and cloud hydration, preserving linked IDs and unrelated custom products. No database schema change or historical activity deletion.
- Updated price-list screen/email effective date and offline cache version.
- Tests: 23 automated tests passed; all 1,168 price fields compared against 292 spreadsheet rows; production build passed. Isolated 412px mobile browser checked search, new price, supplier warning, item price, historical-record upgrade, refresh persistence and no runtime errors/overflow.
- Limitations: authenticated phone/cloud round-trip requires the user's signed-in device. Prices refresh when the updated app opens; offline devices must reconnect once to obtain the new version. Supplier availability remains subject to confirmation.

## 2026-09-11 — v12: quick client entry and editable personal details

- Start Visit always opens a searchable client picker, including for an empty account. Search matches name, area and contact, ignoring case and accents.
- Add new client from the picker; Save client & start visit records the client and captures visit location immediately.
- New-client draft fields and picker search are saved in the current device workspace. Back and reopening retain the draft; successful visit start clears it. Drafts are device-only, not shared between devices.
- Profile & backup → Edit my details allows name, initials, sales territory and reimbursement rate changes. Rate validation accepts R0.01–R1,000 with two decimals.
- New GPS trips snapshot the rate at start. Active trips (including older drafts) and historical trips retain their existing rates when settings change.
- Existing profile sync is reused, with no database migration or record deletion. Background sync status no longer redraws open input forms.
- Tests: mobile picker search, empty/no-result states, draft Back/reload recovery, direct client-to-visit capture, profile persistence, invalid rate, historical/active rate protection, and new 10 km trip at R5.25 = R52.50. Extended isolated cloud-client test covers profile and rate changes.
- Limitation: genuine GPS accuracy, microphone behaviour and authenticated phone sync still depend on on-device testing. No demo data added.

## 2026-09-10 — v11: safer notes and incremental sync

- Preserve full completed-visit notes separately from summaries; include full notes in search and backups.
- Append voice capture by default, with stop and undo; guard late callbacks after navigation or account changes.
- Edit completed notes, feedback and next action without recreating wine relationships or tasks.
- Visible storage-failure warning, retry and recovery download; failed visit completion keeps the active draft. Warn on another browser tab changing the same workspace.
- Replace full-collection delete/upsert with baseline-aware, version-checked record changes. Preserve offline edits and unknown remote records, paginate reads, and review competing device/cloud copies explicitly.
- Disable bulk cloud reset and cascading parent deletion; these require a separately designed safe reset workflow. Guest reset exports a backup first.
- Improve narrow-screen wine controls; collapse the repeat-visit menu/listing-cycle fields and retain contact defaults.
- Add nullable visits.raw_note (4,000 characters) and an app_state update-version trigger. No existing records deleted or rewritten. Add per-account _syncBase metadata in local exports/storage.
- Tests: 21 automated tests; mobile 412px visit/wine/reminder regression; voice append/undo, quota failure/retry/export, full-note persistence and visit editing; production build; dependency audit (0 vulnerabilities). Cloud client tests use an isolated mock, not the owner's account. Database column/constraint/trigger verified remotely.
- Remaining: genuine microphone accuracy and signed-in two-device acceptance need physical testing. Older notes already discarded cannot be reconstructed. Refresh all devices to v11; old clients still use their previous sync code. Browser storage remains removable; export backups. Auth advisor still flags disabled leaked-password protection.
- Later stages remain separate: unknown/recurring buying windows, refined period reports, sample quantities, additional contacts and push notifications.

## 2026-09-10 — Visit detail and buying-window reminders

### Audit findings

#### Working well

- The existing customer, visit, wine relationship, travel, reporting and local-first PWA flows were preserved.
- The master wine list remains the single product source; visit outcomes still update one restaurant-wine relationship without duplication.
- Follow-ups already had usable overdue, today, upcoming and completed groupings.

#### Needed repair

- Visit records did not retain a complete historical contact/venue snapshot, samples left or a clear feedback category.
- Follow-ups did not store their reason, person to contact or reschedule history.
- Rapid actions could stack notifications over the bottom visit controls.

#### Needed improvement

- The visit screen needed structured fields without forcing repeated typing.
- “No current listing opportunity” needed to preserve the account and require useful future timing.
- Listing-cycle prompts needed to remain visibly separate from ordinary follow-up tasks.

#### New functionality required

- Menu/wine-list change and listing-reopen dates or month-only values.
- Configurable 30, 60 or 90-day advance reminders and priority venue views.
- Listing-window metrics in the management report and planning assistant.

### Added

- Complete visit capture for venue/contact details, feedback, next action, current listings, wines discussed, wine interest and samples left.
- A dedicated “Not doing listings now / No current listing opportunity” outcome. Saving this outcome requires a future menu/listing window.
- Separate follow-up reminder fields: required, date, reason, contact person, completed state and rescheduling history.
- Separate menu/listing-cycle reminders with exact-date or month-only capture and 30/60/90-day notice.
- Home, customer, Activity, Reports and Assistant visibility for open and approaching buying windows.
- Historical visit snapshots so later customer edits do not rewrite what was recorded at the visit.

### Fixed

- Wine interest and sample summaries refresh immediately when an outcome changes.
- Completing a follow-up from a customer keeps the customer view current.
- Deleting a visit no longer leaves a dangling visit link on retained follow-up tasks.
- Only the newest confirmation message is shown, preventing stacked notices from obscuring mobile save controls.

### Data and schema changes

- Additive customer fields store menu change timing, listing reopen timing, reminder lead and cycle notes.
- Additive visit fields store the contact snapshot, feedback, listing/sample wine snapshots, follow-up details and cycle timing.
- Additive task fields store reminder type, reason, contact person and bounded reschedule history.
- Existing rows receive safe defaults. No customer, visit, wine, task or travel history is deleted or rewritten.
- Existing Row Level Security and authenticated ownership policies remain active; new text, array and JSON payloads have database limits.

### Tests completed

- 14 automated domain, migration-compatibility, security and workspace tests passed.
- Production build passed.
- A complete 412 × 915 mobile workflow passed with no console errors or horizontal overflow.
- The workflow covered month-only listing timing, the no-opportunity outcome, wine interest, sample left, follow-up creation, rescheduling, completion, reports and refresh persistence.
- Both Supabase migrations applied successfully; added columns and constraints were verified with RLS still enabled.

### Remaining known limitations

- Browser reminders appear inside FieldFlow when the app is opened; Android push notifications require the later notification service/native stage.
- AI structuring remains deterministic and should be reviewed by the rep before saving.
- Supabase Auth still reports leaked-password protection as disabled; enable it before expanding access beyond the pilot.

## 2026-09-09 — Wine listings, travel records and reporting upgrade

### Audit findings

#### Working well

- The existing light, mobile-first Today flow, large touch targets and bottom navigation were retained.
- Client creation/editing, device location, visit timing and notes, product catalogue, PWA installation and local-first storage were functional.
- The supplied 95-product master wine catalogue contained unique IDs, names and SKUs; no duplicate product records were introduced.
- Existing Supabase tables were protected by per-user Row Level Security.

#### Needed repair

- Daily and monthly report controls did not change the report period.
- Travel records could not be entered or corrected manually, lacked business purpose and odometer evidence, and could keep a stale destination point.
- Follow-ups, visits and trips had incomplete edit/delete paths.
- Some card-style actions were not keyboard accessible.

#### Needed improvement

- Follow-ups needed overdue, today and upcoming groupings.
- Search needed status-aware customer and wine filters.
- Reporting needed consistent periods and travel/listing integration.
- Device data needed a user-controlled full backup and safe restore path.

#### New functionality required

- A durable restaurant-to-master-wine relationship and status history.
- Two-way restaurant and wine listing/pipeline views.
- Visit outcomes that update the existing relationship without duplicates.
- Business-grade KM fields, validation, reporting, CSV export and printing.

### Added

- Restaurant-wine statuses: Discussed, Interested, Sampled, Considering, Listed, Delisted and Not Interested.
- Status history, listing and delisting dates, allocation, notes and wine-specific follow-ups.
- Visit wine picker and outcomes connected to the master Wine List.
- Wine pipeline/listing screens in both restaurant and product views.
- Manual and odometer trip capture with restaurant, purpose and notes.
- Today/week/month/custom KM and management report filters.
- KM summaries by account, day and month, plus CSV and print output.
- Integrated activity, pipeline, confirmed listings, conversion and travel metrics.
- Restaurant and wine quick filters for listings, interest and follow-ups.
- Full JSON backup and validated restore with an automatic pre-import safety copy.

### Fixed

- Report period controls now update all metrics.
- A later Discussed visit outcome cannot downgrade a Listed or stronger pipeline relationship.
- Only Listed relationships count as confirmed placements.
- GPS trip completion and visit-linked travel now use a fresh endpoint where location is available.
- Navigation no longer carries an incompatible list filter between screens.
- Odometer totals reject incomplete, impossible or negative readings.
- Local dates are formatted in the device timezone, avoiding early-morning date shifts.
- Visit, task and trip records can be reviewed and corrected without recreating them.

### Data and schema changes

- Added the `customer_wines` table with a unique user/customer/wine relationship, status history, RLS and explicit authenticated grants.
- Added wine outcomes to visits and wine/visit/completion links to tasks.
- Added customer, purpose, odometer, notes and source fields to travel records.
- Existing database changes are additive. Existing device workspaces are normalized on load; historical customers, visits, tasks and trips are retained.

### Tests completed

- 13 domain/business-rule tests passed.
- Production build passed.
- Production dependency audit reported no known vulnerabilities.
- A 412 × 915 mobile workflow passed end to end with no console errors or horizontal overflow.
- Supabase migration applied successfully; new tables and columns have RLS and ownership policies.

### Remaining known limitations

- PWA route recording should stay open; reliable locked-screen/background GPS needs a native Android foreground service.
- Sync is local-first but still collection-level last-write-wins; queued record-level conflict resolution is a later hardening step.
- AI extraction is deterministic and Outlook sharing still opens the device mail app rather than sending directly.
- Supabase Auth currently reports that leaked-password protection is not enabled; enable it before broader access.
