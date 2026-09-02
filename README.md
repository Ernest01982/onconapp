# FieldFlow

FieldFlow is a working, mobile-first field sales CRM prototype designed for a Samsung Ultra-sized screen. It is local-first and can securely back up and sync each signed-in user's CRM data through Supabase.

## Run it

1. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:4173` in a browser.
5. On Android, use the browser menu’s **Add to Home screen** option to test the installed PWA experience.

The prototype starts with realistic sample customers, visits and tasks plus the imported Niew Beverages On Con catalogue effective 1 March 2026. Use the profile button in the top-right corner to restore the original demo data at any time.

## What works

- One-tap location-assisted **Start visit** and **End visit**
- Add never-visited clients and edit venue, contact and opportunity details
- Pin an unlocated client automatically on the first visit or manually from its profile
- Device GPS mileage tracking with start/stop controls
- Nearest-client detection and per-client location pinning from the device
- Automatic distance and reimbursement totals at R4.90 per kilometre
- Live visit timer and device-local capture
- Voice input where browser speech recognition is available, with a typed fallback
- Local note structuring into summary, products, outcome, next action and follow-up date
- Follow-up creation and completion
- Customer/contact records, opportunities and recent visit history
- Search across customers, visits and products
- Imported Niew Beverages catalogue with 95 items across 8 suppliers/categories
- Search by product, alias or barcode; case/unit and tax-inclusive/exclusive pricing
- Supplier-filtered, email-ready price-list sharing
- Daily work overview and weekly management report
- A local assistant that answers common planning and customer-history questions
- Service-worker caching and local-first persistence for offline-safe capture
- Email/password account creation and sign-in
- Secure Supabase backup and cross-device sync protected by per-user Row Level Security

## Prototype boundaries

The app saves to the browser immediately and works without an account. When a user signs in, normalized customer, visit, task, product and travel records sync to Supabase. Its “AI” note extraction and assistant are intentionally deterministic for now so the core workflow can be tested without an AI API key. The price-list and report buttons prepare an email through the device’s configured mail app; direct Microsoft 365 sending is an integration step described in [PRODUCT-NOTES.md](PRODUCT-NOTES.md).

The PWA uses the device’s native browser location permission. Keep the app open while recording a trip because browsers can pause foreground GPS when the screen is locked. The commercial native Android stage uses a foreground location service for reliable, visible background mileage capture.

Before production use, add record-level conflict resolution, server-side AI, consent/audit controls, and production Google/Microsoft integrations. Supabase Auth, the Postgres database and ownership policies are now in place.

## Files

- `index.html` — installable app entry point
- `styles.css` — responsive, touch-first visual system
- `app.js` — data, views and working interaction flows
- `cloud.js` — Supabase authentication and local-first synchronization
- `supabase/migrations` — versioned database schema and RLS policies
- `public/manifest.json` and `public/sw.js` — PWA installation and offline cache
- `package.json` — pinned app dependencies and development/build scripts
- `PRODUCT-NOTES.md` — assumptions, data model, workflows and evolution path
