import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_WORKSPACE_KEY,
  LEGACY_WORKSPACE_KEY,
  getLegacyDecision,
  getLegacyOwner,
  importGuestWorkspace,
  migrateLegacyWorkspaceToGuest,
  readWorkspace,
  reserveLegacyWorkspace,
  userWorkspaceKey,
  workspaceKeyFor,
  writeWorkspace
} from '../workspace.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const seed = {
  profile: { name: 'Ernest' },
  customers: [],
  travel: { ratePerKm: 4.9, trips: [], activeTrip: null, lastPosition: null }
};

test('guest and authenticated workspaces never share a storage key', () => {
  assert.equal(workspaceKeyFor(null), GUEST_WORKSPACE_KEY);
  assert.notEqual(userWorkspaceKey('user-a'), userWorkspaceKey('user-b'));
  assert.notEqual(userWorkspaceKey('user-a'), GUEST_WORKSPACE_KEY);
  assert.notEqual(userWorkspaceKey('user-a'), LEGACY_WORKSPACE_KEY);
});

test('signing out selects an empty guest workspace instead of account data', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, userWorkspaceKey('user-a'), { ...seed, customers:[{ id:'private-a' }] });

  const guest = readWorkspace(storage, workspaceKeyFor(null), seed);
  assert.deepEqual(guest.customers, []);
  assert.deepEqual(readWorkspace(storage, userWorkspaceKey('user-a'), seed).customers, [{ id:'private-a' }]);
});

test('malformed stored data fails closed to the supplied seed', () => {
  const storage = new MemoryStorage();
  storage.setItem(userWorkspaceKey('user-a'), '{broken');
  assert.deepEqual(readWorkspace(storage, userWorkspaceKey('user-a'), seed), seed);
});

test('skipping import reserves the recovery copy for the selected account', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, LEGACY_WORKSPACE_KEY, { ...seed, customers:[{ id:'private-recovery' }] });
  reserveLegacyWorkspace(storage, 'user-a', 'skipped');

  assert.equal(getLegacyOwner(storage), 'user-a');
  assert.throws(() => importGuestWorkspace(storage, 'user-b', seed), /another account/);
});

test('an offline-only legacy workspace upgrades into guest mode without data loss', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, LEGACY_WORKSPACE_KEY, { ...seed, customers:[{ id:'offline-client' }] });

  migrateLegacyWorkspaceToGuest(storage, seed);

  assert.deepEqual(readWorkspace(storage, GUEST_WORKSPACE_KEY, seed).customers, [{ id:'offline-client' }]);
  assert.equal(getLegacyOwner(storage), 'guest');
});

test('explicit guest import moves work into one account and clears signed-out guest data', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, GUEST_WORKSPACE_KEY, { ...seed, customers:[{ id:'guest-client' }] });

  importGuestWorkspace(storage, 'user-a', seed);

  assert.deepEqual(readWorkspace(storage, userWorkspaceKey('user-a'), seed).customers, [{ id:'guest-client' }]);
  assert.deepEqual(readWorkspace(storage, GUEST_WORKSPACE_KEY, seed).customers, []);
  assert.throws(() => importGuestWorkspace(storage, 'user-b', seed), /another account/);
});
