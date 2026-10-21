import {listPhotos,putPhoto,removePhoto,photoHash,reassignPhotoSlots} from './photo-local.js';
export const PHOTO_BUCKET='fieldflow-wine-lists';
const path=(a,id)=>a.userId+'/'+id+'.jpg';
const metadata=r=>({user_id:r.userId,id:r.id,customer_id:r.customerId,visit_id:r.visitId||null,slot:r.slot,filename:r.filename,sha256:r.sha256,bytes:r.blob.size,captured_at:r.capturedAt});
function checkResult(a,result){a.check();if(result.error)throw Error(result.error.message||'Photo cloud request failed. Device copies are retained.');return result.data;}
export async function remotePhotos(a,customerId){
 a.check();return checkResult(a,await a.client.from('wine_list_photos').select('*').eq('user_id',a.userId).eq('customer_id',customerId).order('slot'));
}
function matchesMetadata(row,record,slot=row?.slot){
 return row&&row.user_id===record.userId&&row.id===record.id&&row.customer_id===record.customerId&&
  (row.visit_id||null)===(record.visitId||null)&&row.sha256===record.sha256&&row.bytes===record.blob.size&&
  row.filename===record.filename&&row.slot===slot&&+new Date(row.captured_at)===+new Date(record.capturedAt);
}
async function download(a,row){
 a.check();
 const result=await a.client.storage.from(PHOTO_BUCKET).download(path(a,row.id));a.check();
 if(result.error)throw Error('A cloud photo could not be read. Device copies are retained. Retry online; if it remains missing, export a photo backup and ask for recovery help.');
 const blob=result.data;
 if(await photoHash(blob)!==row.sha256||(row.bytes!=null&&blob.size!==row.bytes))throw Error('Photo readback did not match. The device copy is retained.');a.check();
 return {...row,userId:a.userId,customerId:row.customer_id,visitId:row.visit_id,capturedAt:row.captured_at,blob,verified:true};
}

async function reconcileSlots(a,customerId,remote,local){
 a.check();
 if(new Set([...remote,...local].map(r=>r.id)).size>30)throw Error('Combined device and cloud gallery exceeds 30 pages. Export a photo backup and review before syncing.');
 const occupied=new Set(remote.map(r=>r.slot));
 const assignments=[];
 for(const record of local){
  const same=remote.find(r=>r.id===record.id);
  if(same){
   if(!matchesMetadata(same,record))throw Error('A photo differs between device and cloud. Keep a photo backup and ask for help. No copy was overwritten.');
   assignments.push({id:record.id,slot:same.slot});
  }
 }
 for(const record of local.filter(r=>!remote.some(other=>other.id===r.id))){
  const slot=!occupied.has(record.slot)?record.slot:Array.from({length:30},(_,i)=>i+1).find(n=>!occupied.has(n));
  if(!slot)throw Error('No free photo page slot. Device photos are retained.');
  occupied.add(slot);assignments.push({id:record.id,slot});
 }
 if(assignments.some(item=>local.find(r=>r.id===item.id)?.slot!==item.slot)){
  a.check();await reassignPhotoSlots(a.userId,customerId,assignments);a.check();
  return listPhotos(a.userId,customerId);
 }
 return local;
}

export async function cacheRemotePhotos(a,customerId){
 const remote=await remotePhotos(a,customerId);
 const local=await reconcileSlots(a,customerId,remote,await listPhotos(a.userId,customerId));a.check();
 for(const row of remote){
  if(!local.some(p=>p.id===row.id)){const record=await download(a,row);a.check();await putPhoto(record);a.check();}
 }
 return remote;
}

export async function syncPhotoCopies(a,customerId){
 let remote=await remotePhotos(a,customerId);
 let local=await listPhotos(a.userId,customerId);a.check();
 // Absence may be an intentional deletion on another device. Never resurrect
 // a formerly verified photo automatically or call the current cloud copy safe.
 if(local.some(record=>record.verified&&!remote.some(row=>row.id===record.id)))throw Error('A previously backed-up photo is missing from the cloud gallery. Device copies are retained. Download a photo backup and review the deletion before recovery; nothing was re-uploaded.');
 local=await reconcileSlots(a,customerId,remote,local);a.check();
 for(const record of local){
  a.check();
  const same=remote.find(r=>r.id===record.id);
  if(same){
   if(!matchesMetadata(same,record,record.slot))throw Error('Photo metadata differs from this device. Export a photo backup before recovery.');
   // Historical verified=true says only that an earlier upload was checked.
   // A fresh explicit sync also reads every existing backed-up object.
   await download(a,same);a.check();
   if(!record.verified){await putPhoto({...record,verified:true});a.check();}
   continue;
  }
  const result=await a.client.storage.from(PHOTO_BUCKET).upload(path(a,record.id),record.blob,{contentType:'image/jpeg',upsert:false});a.check();
  // An interrupted attempt may already have uploaded the immutable object.
  // Resolve safe retries by downloading it, never by replacing its bytes.
  if(result.error&&!/duplicate|already exists|resource exists/i.test(result.error.message||''))throw Error(result.error.message);
  await download(a,{id:record.id,sha256:record.sha256,bytes:record.blob.size});a.check();
  checkResult(a,await a.client.from('wine_list_photos').insert(metadata(record)));
  remote=await remotePhotos(a,customerId);
  const readback=remote.find(r=>r.id===record.id);
  if(!matchesMetadata(readback,record,record.slot))throw Error('Photo metadata verification failed. Device copy retained; retry sync.');
  a.check();await putPhoto({...record,verified:true});a.check();record.verified=true;
 }
 return cacheRemotePhotos(a,customerId);
}

export async function deletePhotoCopy(a,record){
 a.check();
 // Deleting needs online verification even for pending uploads: a previous
 // interrupted attempt may already have a remote object or metadata.
 checkResult(a,await a.client.from('wine_list_photos').delete().eq('user_id',a.userId).eq('id',record.id));
 const remaining=await remotePhotos(a,record.customerId);
 if(remaining.some(r=>r.id===record.id))throw Error('Photo deletion was not confirmed. The device copy is retained.');
 checkResult(a,await a.client.storage.from(PHOTO_BUCKET).remove([path(a,record.id)]));
 a.check();await removePhoto(a.userId,record.id);
}
