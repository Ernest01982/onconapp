export const LEGACY_WORKSPACE_KEY = 'fieldflow-prototype-v3';
export const GUEST_WORKSPACE_KEY = 'fieldflow-workspace:guest:v1';
export const LEGACY_DECISION_KEY = 'fieldflow-workspace:legacy-decision:v1';
export const LEGACY_OWNER_KEY = 'fieldflow-workspace:legacy-owner:v1';

export const cloneWorkspace = value => JSON.parse(JSON.stringify(value));

export function userWorkspaceKey(userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) throw new Error('A signed-in user ID is required for an account workspace.');
  return `fieldflow-workspace:user:${normalized}:v1`;
}

export function workspaceKeyFor(userId) {
  return userId ? userWorkspaceKey(userId) : GUEST_WORKSPACE_KEY;
}

export function readWorkspace(storage, key, seed) {
  const fallback = cloneWorkspace(seed);
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback;
    return {
      ...fallback,
      ...saved,
      travel: { ...fallback.travel, ...(saved.travel || {}) }
    };
  } catch {
    return fallback;
  }
}

export function writeWorkspace(storage, key, workspace) {
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
  if (hasWorkspace(storage, GUEST_WORKSPACE_KEY)) return readWorkspace(storage, GUEST_WORKSPACE_KEY, seed);
  const owner = getLegacyOwner(storage);
  const guest = hasWorkspace(storage, LEGACY_WORKSPACE_KEY) && (!owner || owner === 'guest')
    ? transform(readWorkspace(storage, LEGACY_WORKSPACE_KEY, seed))
    : cloneWorkspace(seed);
  writeWorkspace(storage, GUEST_WORKSPACE_KEY, guest);
  if (hasWorkspace(storage, LEGACY_WORKSPACE_KEY) && !owner) storage.setItem(LEGACY_OWNER_KEY, 'guest');
  return guest;
}

export function importGuestWorkspace(storage, userId, seed, transform = value => value) {
  const targetKey = userWorkspaceKey(userId);
  if (hasWorkspace(storage, targetKey)) throw new Error('This account already has a local workspace.');
  const owner = getLegacyOwner(storage);
  if (owner && owner !== 'guest' && owner !== userId) throw new Error('The guest workspace already belongs to another account.');
  const guest = transform(readWorkspace(storage, GUEST_WORKSPACE_KEY, seed));
  storage.setItem(LEGACY_OWNER_KEY, userId);
  if (getLegacyOwner(storage) !== userId) throw new Error('Could not claim the guest workspace safely.');
  try {
    writeWorkspace(storage, targetKey, guest);
    writeWorkspace(storage, GUEST_WORKSPACE_KEY, seed);
    recordLegacyDecision(storage, userId, 'imported');
  } catch (error) {
    if (getLegacyOwner(storage) === userId) storage.setItem(LEGACY_OWNER_KEY, 'guest');
    throw error;
  }
  return guest;
}
