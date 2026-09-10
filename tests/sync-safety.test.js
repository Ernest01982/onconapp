import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,syncDecision,mergeRecords} from '../sync-safety.js';
const old={id:'real-1',note:'First note'};
const base={fingerprint:fingerprint(old),version:'v1'};
test('only explicit local removals of known rows become deletes',()=>{
  assert.equal(syncDecision(undefined,{row:old,version:'v1'},undefined),'remote');
  assert.equal(syncDecision(undefined,{row:old,version:'v1'},base),'delete');
  assert.equal(syncDecision(undefined,{row:old,version:'v2'},base),'conflict');
});
test('offline edits survive reload; unrelated cloud additions are retained',()=>{
  const edited={...old,note:'Offline addition'},extra={id:'real-2',note:'Other device'};
  const result=mergeRecords([edited],[{item:old,version:'v1'},{item:extra,version:'v1'}],{'real-1':base});
  assert.deepEqual(result.items,[edited,extra]);
  assert.equal(result.baselines['real-1'].version,'v1');
});
test('concurrent edits and missing baselines fail closed',()=>{
  const local={...old,note:'Offline'},remote={row:{...old,note:'Cloud'},version:'v2'};
  assert.equal(syncDecision(local,remote,base),'conflict');
  assert.equal(syncDecision(local,remote,undefined),'conflict');
  assert.equal(syncDecision(local,undefined,base),'conflict');
});
test('unchanged device copy adopts cloud edits and deletions',()=>{
  assert.equal(syncDecision(old,{row:{...old,note:'New'},version:'v2'},base),'remote');
  assert.deepEqual(mergeRecords([old],[],{'real-1':base}).items,[]);
});
test('retry after an acknowledged server write is idempotent',()=>{
  const edited={...old,note:'Saved on server'};
  assert.equal(syncDecision(edited,{row:edited,version:'v2'},base),'ack');
});
test('fingerprints ignore database timestamps but preserve all note text',()=>{
  assert.equal(fingerprint({...old,created_at:'a',updated_at:'b'}),fingerprint(old));
  assert.notEqual(fingerprint(old),fingerprint({...old,note:old.note+' important commitment'}));
  assert.equal(fingerprint({at:'2026-09-10T10:00:00+02:00'}),fingerprint({at:'2026-09-10T08:00:00Z'}));
});
