import { fingerprint } from './sync-safety.js';

export const CUSTOMER_FIELD_LIMITS = Object.freeze({
  preferredSupplier: 200,
  additionalContact: 120,
  additionalPhone: 40,
  additionalEmail: 254
});

const databaseDefaults = {
  preferred_supplier: '',
  additional_contact: '',
  additional_phone: '',
  additional_email: '',
  email_follow_ups: []
};
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Defaults must not trim or truncate imported/offline records.
export function normalizeCustomerFields(customer) {
  const normalized = { ...customer };
  for (const field of Object.keys(CUSTOMER_FIELD_LIMITS)) normalized[field] = String(customer?.[field] ?? '');
  return normalized;
}

// v20 baselines predate supplier/extra-contact columns; pre-September-17
// baselines also predate email history. Extend only the saved historical row,
// never the current device/cloud row, so real competing edits still conflict.
export function upgradeCustomerFieldBaselines(workspace) {
  if (!isRecord(workspace)) return workspace;
  for (const key of ['_syncBase', '_syncPendingBase']) {
    const customers = workspace[key]?.customers;
    if (!isRecord(customers)) continue;
    for (const [id, baseline] of Object.entries(customers)) {
      if (!isRecord(baseline) || typeof baseline.fingerprint !== 'string') continue;
      try {
        const row = JSON.parse(baseline.fingerprint);
        if (!isRecord(row) || row.id !== id || typeof row.user_id !== 'string' || !row.user_id || typeof row.name !== 'string') continue;
        if (fingerprint(row) !== baseline.fingerprint) continue;
        let changed = false;
        for (const [field, defaultValue] of Object.entries(databaseDefaults)) {
          if (!Object.hasOwn(row, field)) {
            row[field] = Array.isArray(defaultValue) ? [...defaultValue] : defaultValue;
            changed = true;
          }
        }
        if (changed) baseline.fingerprint = fingerprint(row);
      } catch { /* Unknown/corrupt baselines stay untouched for safe conflict handling. */ }
    }
  }
  return workspace;
}
