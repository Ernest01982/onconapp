import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoto, hashPhotoBlob, nextPhotoSlot, availablePhotoSlots, putPhotos, listPhotos, removePhoto, compressPhoto, PHOTO_MAX_BYTES } from '../photo-local.js';

const fixture = () => ({ userId:'owner-1', customerId:'client-1', id:'photo-1', slot:1, sha256:'a'.repeat(64), blob:new Blob(['image'], { type:'image/jpeg' }), filename:'list.jpg', visitId:null, capturedAt:'2026-10-21T09:00:00.000Z', verified:false });

test('photo validation scopes IDs and preserves metadata without mutating input', () => {
  const source = fixture();
  const checked = validatePhoto(source);
  assert.equal(checked.key, 'owner-1:photo-1');
  assert.equal(source.key, undefined);
  assert.equal(checked.blob, source.blob);
  assert.equal(checked.verified, false);
  assert.throws(() => validatePhoto({ ...source, key:'other:photo-1' }), /different account/);
  for (const userId of ['', null, 'guest:shared', '../owner']) assert.throws(() => validatePhoto({ ...source, userId }), /Sign in/);
  assert.throws(() => validatePhoto({ ...source, customerId:'../client' }), /valid ID/);
});

test('photo validation enforces size, format, page range, checksum and date', () => {
  const source = fixture();
  for (const slot of [0, 31, 1.5, '1']) assert.throws(() => validatePhoto({ ...source, slot }), /1 to 30/);
  for (const blob of [new Blob([],{type:'image/jpeg'}), new Blob(['x'],{type:'image/svg+xml'}), new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)],{type:'image/jpeg'})]) assert.throws(() => validatePhoto({ ...source, blob }), /JPEG/);
  assert.throws(() => validatePhoto({ ...source, sha256:'no' }), /checksum/);
  assert.throws(() => validatePhoto({ ...source, filename:'../list.jpg' }), /filename/);
  assert.throws(() => validatePhoto({ ...source, capturedAt:'not-a-date' }), /capture date/);
  assert.throws(() => validatePhoto({ ...source, verified:'true' }), /backup status/);
  assert.throws(() => validatePhoto({ ...source, visitId:'../visit' }), /visit ID/);
});

test('page allocation uses free slots and rejects a 31st page', () => {
  assert.equal(nextPhotoSlot([]), 1);
  assert.equal(nextPhotoSlot([{slot:1},{slot:3}]), 2);
  assert.deepEqual(availablePhotoSlots(Array.from({length:29},(_,i)=>({slot:i+1}))), [30]);
  assert.throws(() => nextPhotoSlot(Array.from({length:30},(_,i)=>({slot:i+1}))), /already has 30/);
});

test('photo hashes are deterministic SHA-256 values', async () => {
  assert.equal(await hashPhotoBlob(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await hashPhotoBlob(new Blob(['abd'])), await hashPhotoBlob(new Blob(['abc'])));
  await assert.rejects(hashPhotoBlob('abc'), /photo file/);
});

test('bulk import rejects invalid hashes and owners before opening storage', async () => {
  const source = fixture();
  await assert.rejects(putPhotos([source]), /verification failed/);
  source.sha256 = await hashPhotoBlob(source.blob);
  await assert.rejects(putPhotos([source,{...source,id:'photo-2',slot:2,userId:'other-owner'}]), /one account/);
  await assert.rejects(putPhotos([source,{...source,id:'photo-2'}]), /duplicate/);
  await assert.rejects(listPhotos(''), /Sign in/);
  await assert.rejects(removePhoto('owner-1','../photo'), /valid photo ID/);
  assert.deepEqual(await putPhotos([]), []);
});

test('compression rejects unsafe formats and oversized source files before browser decode', async () => {
  await assert.rejects(compressPhoto(new Blob(['svg'], {type:'image/svg+xml'})), /JPEG, PNG or WebP/);
  await assert.rejects(compressPhoto(new Blob([new Uint8Array(25*1024*1024 + 1)], {type:'image/jpeg'})), /25 MB/);
  await assert.rejects(compressPhoto(new Blob([], {type:'image/jpeg'})), /25 MB/);
});
