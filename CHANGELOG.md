# Changelog

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
