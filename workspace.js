export const LEGACY_WORKSPACE_KEY = 'fieldflow-prototype-v3';
export const GUEST_WORKSPACE_KEY = 'fieldflow-workspace:guest:v1';
export const LEGACY_DECISION_KEY = 'fieldflow-workspace:legacy-decision:v1';
export const LEGACY_OWNER_KEY = 'fieldflow-workspace:legacy-owner:v1';
export const GUEST_POINTER_KEY = 'fieldflow-workspace:guest-pointer:v1';
export const recoveryKeyFor = userId => `${userWorkspaceKey(userId)}:import-recovery`;

export const cloneWorkspace = value => JSON.parse(JSON.stringify(value));

export function userWorkspaceKey(userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) throw new Error('A signed-in user ID is required for an account workspace.');
  return `fieldflow-workspace:user:${normalized}:v1`;
}

export function workspaceKeyFor(userId, storage) {
  return userId ? userWorkspaceKey(userId) : storage?.getItem(GUEST_POINTER_KEY) || GUEST_WORKSPACE_KEY;
}

function parseWorkspace(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace');
  for (const key of ['customers','visits','tasks','products','customerWines','chat']) {
    if (key in value && !Array.isArray(value[key])) throw new Error(`Invalid ${key}`);
  }
  if ('travel' in value && (!value.travel || typeof value.travel !== 'object' || Array.isArray(value.travel) || ('trips' in value.travel && !Array.isArray(value.travel.trips)))) throw new Error('Invalid travel');
  return value;
}

export function readWorkspace(storage, key, seed) {
  const fallback = cloneWorkspace(seed);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const saved = parseWorkspace(raw);
    return {
      ...fallback,
      ...saved,
      travel: { ...fallback.travel, ...(saved.travel || {}) }
    };
  } catch {
    const error = new Error('This device workspace could not be read. Nothing has been replaced. Download the recovery file before seeking help.');
    error.workspaceKey = key;
    throw error;
  }
}

export function writeWorkspace(storage, key, workspace) {
  const existing = storage.getItem(key);
  if (existing !== null) parseWorkspace(existing); // Never overwrite unreadable recovery data.
  parseWorkspace(JSON.stringify(workspace));
  storage.setItem(key, JSON.stringify(workspace));
}

export function hasWorkspace(storage, key) {
  return storage.getItem(key) !== null;
}

export function getLegacyDecision(storage, userId) {
  try {
    const decisions = JSON.parse(storage.getItem(LEGACY_DECISION_KEY) || '{}');
    return decisions?.[userId] || null;
  } catch {
    return null;
  }
}

export function recordLegacyDecision(storage, userId, decision) {
  let decisions = {};
  try { decisions = JSON.parse(storage.getItem(LEGACY_DECISION_KEY) || '{}') || {}; }
  catch { decisions = {}; }
  decisions[userId] = decision;
  storage.setItem(LEGACY_DECISION_KEY, JSON.stringify(decisions));
}

export function getLegacyOwner(storage) {
  return storage.getItem(LEGACY_OWNER_KEY);
}

export function reserveLegacyWorkspace(storage, userId, decision) {
  const owner = getLegacyOwner(storage);
  if (owner && owner !== 'guest' && owner !== userId) throw new Error('The earlier workspace already belongs to another account.');
  storage.setItem(LEGACY_OWNER_KEY, userId);
  if (getLegacyOwner(storage) !== userId) throw new Error('Could not claim the earlier workspace safely.');
  recordLegacyDecision(storage, userId, decision);
}

export function migrateLegacyWorkspaceToGuest(storage, seed, transform = value => value) {
  const guestKey = workspaceKeyFor(null, storage);
  if (hasWorkspace(storage, guestKey)) return readWorkspace(storage, guestKey, seed);
  const owner = getLegacyOwner(storage);
  const guest = hasWorkspace(storage, LEGACY_WORKSPACE_KEY) && (!owner || owner === 'guest')
    ? transform(readWorkspace(storage, LEGACY_WORKSPACE_KEY, seed))
    : cloneWorkspace(seed);
  writeWorkspace(storage, guestKey, guest);
  if (hasWorkspace(storage, LEGACY_WORKSPACE_KEY) && !owner) storage.setItem(LEGACY_OWNER_KEY, 'guest');
  return guest;
}

export function importGuestWorkspace(storage, userId, seed, transform = value => value, backupConfirmed = false) {
  const targetKey = userWorkspaceKey(userId);
  if (hasWorkspace(storage, targetKey)) throw new Error('This account already has a local workspace.');
  const owner = getLegacyOwner(storage);
  if (owner && owner !== 'guest' && owner !== userId) throw new Error('The guest workspace already belongs to another account.');
  if (!backupConfirmed) throw new Error('Export and confirm a saved backup before importing this device.');
  const sourceKey = workspaceKeyFor(null, storage);
  const guest = transform(readWorkspace(storage, sourceKey, seed));
  const raw = storage.getItem(sourceKey);
  if (!raw) throw new Error('No device workspace is available to import.');
  const recoveryKey = recoveryKeyFor(userId);
  if (!hasWorkspace(storage, recoveryKey)) storage.setItem(recoveryKey, raw);
  if (storage.getItem(recoveryKey) !== raw) throw new Error('A different recovery copy already exists. Keep both backups and review before importing.');
  delete guest._syncBase;
  delete guest._syncPendingBase;
  storage.setItem(LEGACY_OWNER_KEY, userId);
  if (getLegacyOwner(storage) !== userId) throw new Error('Could not claim the guest workspace safely.');
  try {
    writeWorkspace(storage, targetKey, guest);
    // Retain the original bytes forever. Signed-out users get a separate empty workspace.
    const nextGuestKey = `${GUEST_WORKSPACE_KEY}:after:${userId}`;
    if (!hasWorkspace(storage, nextGuestKey)) writeWorkspace(storage, nextGuestKey, seed);
    storage.setItem(GUEST_POINTER_KEY, nextGuestKey);
    recordLegacyDecision(storage, userId, 'imported');
  } catch (error) {
    if (getLegacyOwner(storage) === userId) storage.setItem(LEGACY_OWNER_KEY, 'guest');
    throw error;
  }
  return guest;
}
