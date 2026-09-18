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
  recoveryKeyFor,
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

test('malformed stored data blocks reads and writes without overwriting the original', () => {
  const storage = new MemoryStorage();
  storage.setItem(userWorkspaceKey('user-a'), '{broken');
  assert.throws(()=>readWorkspace(storage, userWorkspaceKey('user-a'), seed), /could not be read/);
  assert.throws(()=>writeWorkspace(storage,userWorkspaceKey('user-a'),seed));
  assert.equal(storage.getItem(userWorkspaceKey('user-a')),'{broken');
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

test('confirmed import retains original records and recovery but isolates signed-out guest data', () => {
  const storage = new MemoryStorage();
  writeWorkspace(storage, GUEST_WORKSPACE_KEY, { ...seed, customers:[{ id:'guest-client' }] });

  const original=storage.getItem(GUEST_WORKSPACE_KEY);
  assert.throws(()=>importGuestWorkspace(storage,'user-a',seed),/backup/);
  assert.equal(storage.getItem(userWorkspaceKey('user-a')),null);
  importGuestWorkspace(storage, 'user-a', seed, value=>value, true);

  assert.deepEqual(readWorkspace(storage, userWorkspaceKey('user-a'), seed).customers, [{ id:'guest-client' }]);
  assert.equal(storage.getItem(GUEST_WORKSPACE_KEY),original);
  assert.equal(storage.getItem(recoveryKeyFor('user-a')),original);
  assert.deepEqual(readWorkspace(storage, workspaceKeyFor(null,storage), seed).customers, []);
  assert.throws(() => importGuestWorkspace(storage, 'user-b', seed), /another account/);
});

test('invalid collections are blocked and import failures keep the original',()=>{
  const storage=new MemoryStorage();
  storage.setItem(GUEST_WORKSPACE_KEY,JSON.stringify({...seed,customers:{}}));
  assert.throws(()=>readWorkspace(storage,GUEST_WORKSPACE_KEY,seed),/could not be read/);
  const raw=JSON.stringify({...seed,customers:[{id:'preserve'}]});storage.setItem(GUEST_WORKSPACE_KEY,raw);
  const originalSet=storage.setItem.bind(storage);
  storage.setItem=(key,value)=>{if(key===userWorkspaceKey('user-a'))throw new Error('Quota full');originalSet(key,value);};
  assert.throws(()=>importGuestWorkspace(storage,'user-a',seed,value=>value,true),/Quota/);
  assert.equal(storage.getItem(GUEST_WORKSPACE_KEY),raw);
  assert.equal(storage.getItem(recoveryKeyFor('user-a')),raw);
});
