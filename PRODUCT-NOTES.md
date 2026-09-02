# FieldFlow product notes

## Product intent

FieldFlow is a field rep’s daily companion rather than a traditional desk CRM. The core loop is: arrive, tap once, speak naturally, confirm the useful facts, leave with the follow-up already created. The home screen therefore prioritises Today, Start Visit, Follow-ups, Price List and the Assistant; reporting and administration remain one level deeper.

## Assumptions

- The first pilot has one field rep and one primary Samsung Android device.
- Visits are intentionally started and ended by the rep. Background detection can suggest visits later, but it should not silently create customer records.
- A customer/venue has a known location before most visits. Live coordinates can be compared with that venue location.
- Voice capture must always have a typed fallback, particularly in noisy venues.
- The device can be offline for part of the day; starting, noting and ending a visit must not depend on a network response.
- Product prices are the supplied Niew Beverages On Con prices effective 1 March 2026. The app retains both excluding- and including-tax case and unit values.
- Price-list sharing should open the user’s mail app in the prototype. Direct Outlook sending requires Microsoft sign-in and user consent.
- AI output is suggested structure, not an irreversible source of truth. The rep should be able to review it before sync.

## Data model

| Entity | Important fields | Relationships |
|---|---|---|
| User | id, name, territory, timezone, organisation_id | Owns visits and tasks; belongs to an organisation later |
| Customer | id, name, type, address, latitude, longitude, opportunity_value, last_visit_at | Has contacts, visits and tasks |
| Contact | id, customer_id, name, role, phone, email | Belongs to a customer |
| Visit | id, user_id, customer_id, started_at, ended_at, start/end coordinates, duration, summary, outcome, sync_status | Has note, products and actions |
| Visit note | id, visit_id, transcript, structured_json, source, confidence, reviewed_at | Belongs to a visit |
| Task | id, customer_id, visit_id, owner_id, title, due_at, completed_at, priority | May be created from a visit |
| Product | id, sku, name, category, pack, active | Appears on price lists and visits |
| Price-list item | price_list_id, product_id, unit/pack price, VAT, effective dates | Versioned for safe sharing |
| Visit product | visit_id, product_id, discussion type, quantity/value where known | Many-to-many link |
| Location event | id, user_id, captured_at, coordinates, accuracy, source, consent state | Optional commercial audit trail |
| Travel trip | id, user_id, started_at, ended_at, ordered GPS points, distance_km, rate_per_km, reimbursement, start/end customer IDs | Links business mileage to clients and reports |

For a commercial multi-user version, every business row should carry `organisation_id`, timestamps, created/updated actor IDs and a soft-delete or archival state. Access rules must isolate organisations and territories.

## Major workflows

### Start and finish a visit

1. Rep taps **Start visit** and selects a nearby or recent customer.
2. The app requests foreground location and records the coordinate, accuracy, time and chosen venue.
3. A local visit record is created immediately with `pending_sync` status.
4. During the visit, voice or typed notes save locally as they change.
5. Note processing suggests a summary, products, outcome, next action and date.
6. Rep ends the visit; duration is calculated and any confirmed next action becomes a follow-up.
7. When online, an idempotent queue syncs the visit, note and task to the server.

### Add and maintain a client

The rep can add a client before any visit with only a venue name; area, street address, type, primary contact, contact details and opportunity information can be completed immediately or later. New clients show **Never visited** until their first completed visit. The client profile exposes **Edit details** for future corrections.

Location is optional at creation. If a client has no saved coordinates, the first location-assisted visit pins the venue to the device’s current position. The rep can also use **Save this location** from the client profile while standing at the venue. Commercial sync should retain who changed customer details, previous values and when a location was repinned.

### Assisted automatic visit logging

The safest first automation is a suggestion, not full passive tracking. The Android app can use a geofence around known venues, dwell time and motion state to prompt: “You appear to be at a saved client. Start a visit?” On departure it can prompt to end the active visit. This preserves control, reduces false visits and makes consent understandable. A later organisation policy may enable a work-hours-only background timeline with visible status and pause controls.

### Mileage and reimbursement

1. The rep taps **Start driving**, which requests precise device location and creates a local trip.
2. While the PWA remains active, accurate GPS points are appended only after movement exceeds a threshold based on reported accuracy. This reduces stationary GPS drift.
3. The app compares the first and last positions with saved customer coordinates and labels a client when the endpoint is within 500 metres.
4. On **Stop driving**, the route distance is calculated from consecutive accepted points using great-circle distance.
5. Reimbursement equals the recorded kilometres multiplied by the configured R4.90/km rate. The rate is stored on each completed trip so historical claims remain auditable if the policy changes later.
6. The trip and claim appear in Today, Travel, weekly reporting and the emailed management summary.

The customer detail screen includes **Save this location**, allowing a rep to stand at a venue and replace its saved coordinates with the device’s current position. For payroll-grade use, the backend should retain GPS accuracy, raw points, edits, rate policy/version and approval status.

### Price-list sharing

The prototype builds an email-ready text list. The pilot should select a versioned price list, generate a PDF or secure link on the server, show the intended recipient and attachment, and then either open Outlook or send through Microsoft Graph after explicit confirmation. Record the version, recipient, sender and timestamp for audit.

### Management reporting

Daily, weekly and monthly aggregates should be computed from completed visits and tasks: visits, unique customers, duration in trade, outcomes, tasks due/completed, opportunities, products discussed and unvisited/under-visited customers. Commercial reports should filter by rep, territory, team and date, and retain links to the source records.

## Architecture path

The current OnconApp Supabase project is the first production-shaped backend foundation. Seven public tables are exposed only to authenticated users, every table has Row Level Security, and every policy checks `auth.uid()` against the row owner. Anonymous access is revoked and authenticated grants are explicit. The app always writes locally first, then synchronizes changed collections after sign-in or when connectivity returns. This first sync uses last-write-wins at collection level; record versioning and conflict prompts remain a pilot hardening task.

### Stage 1 — current zero-cost prototype

- Installable PWA using standard HTML, CSS and JavaScript
- Browser geolocation only when starting a visit
- Foreground GPS route recording, nearest-client calculation and local mileage claims
- Service-worker app shell and device-local data
- Optional Supabase Auth and Postgres cloud backup, with per-user Row Level Security
- Normalized cloud records for profiles, customers, visits, tasks, products and travel trips
- Browser/device speech recognition when supported
- Deterministic note structuring and assistant answers
- `mailto:` sharing through the configured mail app

This stage proves the workflow and vocabulary without infrastructure cost.

### Stage 2 — single-user field pilot

- PWA with IndexedDB, or a small Android shell around the web UI
- Replace the current last-write-wins synchronization with an IndexedDB operation queue, idempotency keys and explicit conflict rules
- Server-side AI endpoint returning a strict JSON schema; no AI secret in the app
- Foreground location plus user-approved visit suggestions
- Microsoft sign-in and direct Outlook sending
- Remote feature flags, structured logs and crash reporting

### Stage 3 — commercial Android product

- Native Android app using Kotlin/Jetpack Compose and Room for robust offline work
- Android fused location provider, geofences and foreground service only where justified
- Tenant-isolated backend, organisation roles, territory ownership and row-level access rules
- Versioned products/pricing, approval workflows and immutable audit events
- Queued background sync, conflict resolution and device revocation
- AI evaluation set, confidence thresholds, human review and usage/cost controls
- Team dashboards, scheduled report delivery and CSV/PDF exports

## Google location and Maps path

The prototype uses the browser Geolocation API and a stored venue coordinate, which has no Google API dependency. For native Android, request foreground location only at the moment it adds value. Android distinguishes approximate/precise and foreground/background access; background location requires separate handling and a clear rationale. Google explicitly advises checking whether background access is necessary. See the [Android location permission guide](https://developer.android.com/develop/sensors-and-location/location/permissions) and [background location guide](https://developer.android.com/develop/sensors-and-location/location/permissions/background).

Use the Maps SDK only when the rep needs a visual map, and the Places SDK for venue search/autocomplete or current-place matching. Google Maps Platform requires a billing-enabled project and protected API credentials even where a SKU has a free usage cap. Pricing is pay-as-you-go by billable event and can change; set API restrictions, per-day quotas and budget alerts. As of 2 September 2026, Google’s global list shows unlimited free usage for the Maps SDK SKU, while several Places/Geocoding SKUs have monthly free caps and charge beyond them. Recheck the [current Google Maps pricing table](https://developers.google.com/maps/billing-and-pricing/pricing) before launch and request only the Places fields actually needed.

## Microsoft Outlook path

The current prototype uses `mailto:` so the rep remains in control and no Microsoft permission is required. For direct sending:

1. Register the Android/PWA application in Microsoft Entra ID.
2. Use Microsoft Authentication Library (MSAL) with OAuth 2.0 authorisation code flow and PKCE; never embed a client secret in a mobile app.
3. Request delegated `Mail.Send` only when the user first enables direct sending.
4. Preview the recipient, subject, body and attachment before confirmation.
5. Call `POST /me/sendMail` and record the result locally/server-side. Microsoft Graph returns `202 Accepted`; this means accepted for processing, not guaranteed delivery.

Microsoft documents MSAL for Android in its [MSAL Android overview](https://learn.microsoft.com/en-us/entra/msal/android/), PKCE support in [authentication flows](https://learn.microsoft.com/en-us/entra/identity-platform/msal-authentication-flows), and the least-privileged `Mail.Send` permission in the [Graph sendMail reference](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Privacy and operational safeguards

- Explain location use in plain language before the system permission prompt.
- Default to work-hours-only, foreground capture; make tracking state visible and pausable.
- Store accuracy and capture source so reports do not overstate precision.
- Encrypt data in transit and at rest. Let the authentication SDK manage the user session; never place service-role, Microsoft client-secret or AI provider keys in the browser.
- Separate raw transcript retention from structured CRM facts, with a configurable retention period.
- Provide export, correction and deletion routes appropriate to the organisation’s legal obligations.
- Log automated suggestions and user corrections to improve extraction quality safely.

## Validation completed

The prototype was exercised in an automated Edge browser at 412 × 915 and 360 × 800 pixels. The tested path covered start visit, live location capture, note entry, structured extraction, end visit, generated follow-up and assistant response. Customers, activity, products, reports and follow-up creation were also checked. No runtime errors or horizontal overflow were observed in those checks.
