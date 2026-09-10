# Changelog

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
