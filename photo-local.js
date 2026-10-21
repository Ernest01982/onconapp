// Private on-device photos are separate from the small CRM localStorage payload.
// Callers must additionally check their captured account identity after every await.
export const PHOTO_LIMIT = 30;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_INPUT_MAX_BYTES = 25 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 60_000_000;
const DATABASE = 'fieldflow-private-photos-v1';
const STORE = 'photos';
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validSlot = value => Number.isInteger(value) && value >= 1 && value <= PHOTO_LIMIT;

function requireOwner(userId) {
  if (!safeId(userId)) throw new Error('Sign in before using wine-list photos.');
}

export function availablePhotoSlots(records = []) {
  const occupied = new Set(records.map(record => record.slot));
  return Array.from({ length:PHOTO_LIMIT }, (_, index) => index + 1).filter(slot => !occupied.has(slot));
}

export function nextPhotoSlot(records = []) {
  const slot = availablePhotoSlots(records)[0];
  if (!slot) throw new Error('This client already has 30 photos. Remove a photo before adding another.');
  return slot;
}

export function validatePhoto(record) {
  if (!record || typeof record !== 'object') throw new Error('Invalid wine-list photo.');
  requireOwner(record.userId);
  if (!safeId(record.id) || !safeId(record.customerId)) throw new Error('The photo needs a valid ID and client.');
  const key = `${record.userId}:${record.id}`;
  if (record.key != null && record.key !== key) throw new Error('The photo belongs to a different account or ID.');
  if (!validSlot(record.slot)) throw new Error('A photo must use a page slot from 1 to 30.');
  if (!/^[a-f0-9]{64}$/.test(record.sha256 || '')) throw new Error('The photo checksum is missing or invalid.');
  if (!(record.blob instanceof Blob) || record.blob.type !== 'image/jpeg' || !record.blob.size || record.blob.size > PHOTO_MAX_BYTES) throw new Error('Photos must be JPEG files no larger than 2 MB.');
  if (typeof record.filename !== 'string' || !record.filename || record.filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(record.filename)) throw new Error('The photo filename is invalid.');
  if (record.visitId != null && record.visitId !== '' && !safeId(record.visitId)) throw new Error('The photo visit ID is invalid.');
  if (typeof record.capturedAt !== 'string' || !Number.isFinite(Date.parse(record.capturedAt))) throw new Error('The photo capture date is invalid.');
  if (typeof record.verified !== 'boolean') throw new Error('The photo backup status is invalid.');
  return { ...record, key, visitId:record.visitId || null };
}

export async function hashPhotoBlob(blob) {
  if (!(blob instanceof Blob)) throw new Error('A photo file is required.');
  if (!globalThis.crypto?.subtle) throw new Error('Photo verification requires a secure browser connection.');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export const sha256Blob = hashPhotoBlob;
export const photoHash = hashPhotoBlob;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('This browser cannot save photos offline.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const photos = request.result.createObjectStore(STORE, { keyPath:'key' });
      photos.createIndex('owner', 'userId', { unique:false });
      photos.createIndex('client', ['userId', 'customerId'], { unique:false });
      photos.createIndex('client-slot', ['userId', 'customerId', 'slot'], { unique:true });
    };
    request.onerror = () => reject(request.error || new Error('Could not open offline photo storage.'));
    request.onblocked = () => reject(new Error('Close other FieldFlow tabs and retry opening photo storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export async function listPhotos(userId, customerId) {
  requireOwner(userId);
  if (customerId !== undefined && !safeId(customerId)) throw new Error('A valid client is required.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const index = transaction.objectStore(STORE).index(customerId === undefined ? 'owner' : 'client');
    const request = index.getAll(customerId === undefined ? userId : [userId, customerId]);
    transaction.oncomplete = () => { db.close(); resolve(request.result.sort((a,b) => a.customerId.localeCompare(b.customerId) || a.slot - b.slot)); };
    transaction.onabort = () => { db.close(); reject(transaction.error || request.error || new Error('Could not read saved photos.')); };
    transaction.onerror = () => {};
  });
}

// One transaction: a failed image/checksum/slot leaves the complete import unchanged.
export async function putPhotos(records) {
  if (!Array.isArray(records)) throw new Error('Photos must be an array.');
  if (!records.length) return [];
  const checked = records.map(validatePhoto);
  const keys = new Set();
  const slots = new Set();
  const owner = checked[0].userId;
  for (const photo of checked) {
    if (photo.userId !== owner) throw new Error('A photo import must belong to one account.');
    const slot = `${photo.userId}:${photo.customerId}:${photo.slot}`;
    if (keys.has(photo.key) || slots.has(slot)) throw new Error('The photo import contains duplicate IDs or page slots.');
    keys.add(photo.key); slots.add(slot);
    if (await hashPhotoBlob(photo.blob) !== photo.sha256) throw new Error('Photo verification failed. No photos were imported.');
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const photos = transaction.objectStore(STORE);
    let failure;
    for (const photo of checked) {
      const existing = photos.get(photo.key);
      existing.onsuccess = () => {
        const prior = existing.result;
        if (prior && (prior.userId !== photo.userId || prior.customerId !== photo.customerId || prior.sha256 !== photo.sha256)) {
          failure = new Error('An existing photo has different contents or a different client. The saved copy was kept.');
          transaction.abort();
          return;
        }
        photos.put(photo);
      };
    }
    transaction.oncomplete = () => { db.close(); resolve(checked); };
    transaction.onabort = () => {
      db.close();
      const error = transaction.error;
      reject(failure || (error?.name === 'ConstraintError'
        ? new Error('Another photo already uses that page slot. No photos were changed; refresh the gallery and retry.')
        : error?.name === 'QuotaExceededError'
          ? new Error('Device storage is full. No photos were changed. Free some space and retry.')
          : error || new Error('Photo save failed. Check device storage and retry.')));
    };
    transaction.onerror = () => {};
  });
}

export async function putPhoto(record) {
  return (await putPhotos([record]))[0];
}

// Move page slots as one transaction so swaps cannot collide halfway through.
// Stored blobs and metadata are read inside that transaction and retained.
export async function reassignPhotoSlots(userId, customerId, assignments) {
  requireOwner(userId);
  if (!safeId(customerId) || !Array.isArray(assignments)) throw new Error('A valid client and photo slots are required.');
  const desired = new Map();
  for (const item of assignments) {
    if (!safeId(item?.id) || !validSlot(item.slot) || desired.has(item.id)) throw new Error('Invalid or duplicate photo slot assignment.');
    desired.set(item.id, item.slot);
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const photos = transaction.objectStore(STORE);
    const request = photos.index('client').getAll([userId, customerId]);
    let failure, updated;
    request.onsuccess = () => {
      const current = request.result;
      if ([...desired.keys()].some(id => !current.some(photo => photo.id === id))) {
        failure = new Error('The photo gallery changed. Reopen it before retrying sync.');
        transaction.abort(); return;
      }
      updated = current.map(photo => ({ ...photo, slot:desired.get(photo.id) ?? photo.slot }));
      if (new Set(updated.map(photo => photo.slot)).size !== updated.length || updated.length > PHOTO_LIMIT) {
        failure = new Error('Photo page slots conflict. All device copies were retained.');
        transaction.abort(); return;
      }
      // Deletes and puts commit together or all roll back, retaining every blob.
      for (const photo of current) photos.delete(photo.key);
      for (const photo of updated) photos.put(photo);
    };
    transaction.oncomplete = () => { db.close(); resolve(updated); };
    transaction.onabort = () => { db.close(); reject(failure || transaction.error || new Error('Could not reconcile photo slots. Device copies retained.')); };
    transaction.onerror = () => {};
  });
}

export async function removePhoto(userId, id) {
  requireOwner(userId);
  if (!safeId(id)) throw new Error('A valid photo ID is required.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(`${userId}:${id}`);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Could not remove the saved photo.')); };
    transaction.onerror = () => {};
  });
}

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation:'from-image' });
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The photo could not be opened. Use a JPEG, PNG or WebP image.')); };
    image.src = url;
  });
}

export async function compressPhoto(file) {
  if (!(file instanceof Blob) || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo. HEIC/RAW files are not supported.');
  if (!file.size || file.size > PHOTO_INPUT_MAX_BYTES) throw new Error('Choose a photo smaller than 25 MB.');
  let image;
  let canvas;
  try {
    image = await decodePhoto(file);
    const inputWidth = image.width || image.naturalWidth;
    const inputHeight = image.height || image.naturalHeight;
    if (!inputWidth || !inputHeight || inputWidth * inputHeight > PHOTO_MAX_PIXELS) throw new Error('Use a photo of 60 megapixels or less.');
    const ratio = Math.min(1, 2400 / Math.max(inputWidth, inputHeight));
    const width = Math.max(1, Math.round(inputWidth * ratio));
    const height = Math.max(1, Math.round(inputHeight * ratio));
    canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare photos.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The photo could not be prepared.')), 'image/jpeg', 0.86));
    if (!blob.size || blob.size > PHOTO_MAX_BYTES) throw new Error('This photo is still larger than 2 MB. Use a smaller image or photograph fewer pages at once.');
    const name = String(file.name || 'wine-list').replace(/\.[^.]+$/, '').replace(/[\x00-\x1f\x7f/\\]/g, '-').slice(0, 140) || 'wine-list';
    return { blob, sha256:await hashPhotoBlob(blob), width, height, filename:`${name}.jpg`, mimeType:'image/jpeg', size:blob.size };
  } finally {
    image?.close?.();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}
