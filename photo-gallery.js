import {listPhotos,putPhoto,putPhotos,compressPhoto,photoHash,nextPhotoSlot} from './photo-local.js';
import {expandScanFiles} from './scan-import.js';
import {cacheRemotePhotos,syncPhotoCopies,deletePhotoCopy} from './photo-cloud.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const download=(name,blob)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
const base64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
export function mountPhotoGallery(host,{access:a,customerId,visitId=null,syncCrm}){
 let disposed=false,busy=false,urls=[],records=[],status='Loading device photos…';
 const check=()=>{a.check();if(disposed)throw Error('Photo gallery was closed. Reopen it to continue.');};
 const cleanup=()=>{urls.forEach(URL.revokeObjectURL);urls=[];};
 const render=()=>{
  if(disposed)return;cleanup();
  host.innerHTML='<p class="modal-hint">Up to 30 pages per client. Saved here first; cloud photo verification is separate from CRM sync. Take clear, well-lit pictures and check the text at full size.</p>'+
   '<p role="status" class="photo-status">'+esc(status)+'</p><p><strong>'+records.length+' / 30 photos</strong> · '+records.filter(r=>!r.verified).length+' waiting for upload</p>'+
   '<div class="customer-actions"><label class="btn btn-primary">Camera / scan<input data-photo-camera type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden '+(busy?'disabled':'')+'></label><label class="btn btn-secondary">Import photos / scan PDF<input data-photo-files type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple hidden '+(busy?'disabled':'')+'></label><button class="btn btn-secondary" data-photo-sync '+(busy?'disabled':'')+'>Sync photos</button></div>'+
   '<details class="scan-help"><summary>Using your Samsung document scanner</summary><p>Camera / scan opens the camera your browser provides. If it offers Scan, use it to crop the page. FieldFlow cannot force Samsung’s scanner mode. You can also scan in Samsung Camera or another trusted scanner, save as JPEG or PDF, then choose Import photos / scan PDF here.</p><p>Each PDF page counts toward the 30-page limit. Use JPEG, PNG, WebP or PDF (25 MB per file). Keep the original scan and check the saved pages are readable. Images are compressed for storage; this does not read or transcribe their text.</p></details>'+
   '<div class="photo-grid">'+records.map((r,i)=>{const url=URL.createObjectURL(r.blob);urls.push(url);return '<article><button data-photo-open="'+esc(r.id)+'" class="photo-thumb" aria-label="Open page '+(i+1)+'"><img src="'+url+'" alt="Wine-list page '+(i+1)+'" loading="lazy"></button><span>Page '+(i+1)+' · '+(r.verified?'Last upload verified':'Device only')+'</span><button class="text-btn" data-photo-delete="'+esc(r.id)+'" '+(busy?'disabled':'')+'>Delete</button></article>';}).join('')+'</div>'+
   '<div class="photo-preview" hidden></div><details><summary>Photo backup and recovery</summary><p class="field-help">The normal CRM JSON backup does not contain pictures. Download this client’s separate photo backup and keep it off your phone. A backup includes only the '+records.length+' pictures available here; sync first to collect other-device photos. Restoring requires the same account and client.</p><button class="btn btn-secondary" data-photo-backup '+(busy?'disabled':'')+'>Download photo backup</button><label class="btn btn-secondary">Restore photo backup<input data-photo-restore type="file" accept=".json,application/json" hidden '+(busy?'disabled':'')+'></label></details>';
 };
 const load=async()=>{records=await listPhotos(a.userId,customerId);check();records.sort((x,y)=>x.slot-y.slot||x.capturedAt.localeCompare(y.capturedAt));render();};
 const run=async(task)=>{
  if(busy)return;busy=true;render();
  try{check();await task();check();}
  catch(e){if(!disposed)status=e.message||'Photo operation failed. Saved copies are retained.';}
  finally{busy=false;if(!disposed){try{await load();}catch{cleanup();host.textContent='Photo access changed. Close and reopen this client after signing in.';}}}
 };
 const sync=async()=>{if(!navigator.onLine)throw Error('Offline. Device photos are retained. Connect and tap Sync photos.');status='Uploading and verifying photos…';render();if(!await syncCrm())throw Error('CRM sync is still running or needs attention. Photos remain on this device; wait for CRM sync to finish or resolve its warning, then tap Sync photos again.');check();await syncPhotoCopies(a,customerId);check();status='Photo upload and readback verified. Device copies retained.';};
 host.addEventListener('change',async e=>{
  if(e.target.matches('[data-photo-files],[data-photo-camera]')){
   const selectedFiles=[...e.target.files];e.target.value='';if(!selectedFiles.length)return;
   await run(async()=>{
    status='Preparing photos / scan pages…';render();
    const files=await expandScanFiles(selectedFiles,30-records.length);check();
    let added=0;
    try{for(const file of files){const packed=await compressPhoto(file);check();const current=await listPhotos(a.userId,customerId);check();await putPhoto({userId:a.userId,customerId,id:crypto.randomUUID(),slot:nextPhotoSlot(current),filename:packed.filename,blob:packed.blob,sha256:packed.sha256,visitId,capturedAt:new Date().toISOString(),verified:false});added++;}}
    catch(e){throw Error(added+' photo(s) saved on device. '+e.message);}
    status=added+' photo(s) saved on device.';await load();
    if(navigator.onLine)await sync();else status+=' Offline — tap Sync photos when connected.';
   });
  }else if(e.target.matches('[data-photo-restore]')){
   const file=e.target.files[0];e.target.value='';if(!file)return;
   await run(async()=>{
    if(file.size>90*1024*1024)throw Error('Photo backup is too large.');
    const backup=JSON.parse(await file.text());check();
    if(backup.format!=='fieldflow-photos-v1'||backup.userId!==a.userId||backup.customerId!==customerId||!Array.isArray(backup.photos)||backup.photos.length>30)throw Error('Use a photo backup for this same account and client.');
    const current=await listPhotos(a.userId,customerId),restored=[];
    for(const raw of backup.photos){
     if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.id)||typeof raw.base64!=='string'||raw.base64.length>2800000)throw Error('Invalid photo backup image.');
     const bytes=Uint8Array.from(atob(raw.base64),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'image/jpeg'});
     if(await photoHash(blob)!==raw.sha256)throw Error('A backup image failed its integrity check.');
     const existing=current.find(r=>r.id===raw.id);
     if(existing){if(existing.sha256!==raw.sha256)throw Error('Photo ID conflict. No existing copy was overwritten.');continue;}
     restored.push({userId:a.userId,customerId,id:raw.id,slot:nextPhotoSlot([...current,...restored]),filename:raw.filename,sha256:raw.sha256,capturedAt:raw.capturedAt,visitId:raw.visitId||null,blob,verified:false});
    }
    check();await putPhotos(restored);status=restored.length+' photos restored to this device. Tap Sync photos to back them up.';
   });
  }
 });
 host.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-photo-sync'))await run(sync);
  else if(button.hasAttribute('data-photo-open')){
   const record=records.find(r=>r.id===button.dataset.photoOpen);if(!record)return;
   const url=URL.createObjectURL(record.blob);urls.push(url);const preview=host.querySelector('.photo-preview');
   preview.innerHTML='<button class="btn btn-secondary" data-photo-close>Close full-size photo</button><p>Scroll or pinch to inspect the text.</p><img src="'+url+'" alt="Full-size wine list"><button class="btn btn-secondary" data-photo-download="'+esc(record.id)+'">Download this picture</button>';preview.hidden=false;preview.scrollIntoView({block:'start'});
  }else if(button.hasAttribute('data-photo-close'))host.querySelector('.photo-preview').hidden=true;
  else if(button.hasAttribute('data-photo-download')){const record=records.find(r=>r.id===button.dataset.photoDownload);if(record){check();download(record.filename,record.blob);}}
  else if(button.hasAttribute('data-photo-delete')){
   const record=records.find(r=>r.id===button.dataset.photoDelete);if(!record||!confirm('Delete this photo from this device and your account? Download a photo backup first.'))return;
   await run(async()=>{if(!navigator.onLine)throw Error('Connect before deleting so cloud removal can be verified.');await deletePhotoCopy(a,record);status='Photo removed from device and cloud.';});
  }else if(button.hasAttribute('data-photo-backup'))await run(async()=>{
   const photos=[];for(const record of records){const {blob,key,...meta}=record;photos.push({...meta,base64:await base64(blob)});check();}
   download('fieldflow-photos-'+customerId+'.json',new Blob([JSON.stringify({format:'fieldflow-photos-v1',userId:a.userId,customerId,exportedAt:new Date().toISOString(),photos})],{type:'application/json'}));status='Photo backup download requested. Check the file exists in Downloads.';
  });
 });
 run(async()=>{await load();if(navigator.onLine){await cacheRemotePhotos(a,customerId);check();status='Device gallery loaded. Tap Sync photos to upload pending pages.';}else status='Offline — showing device photos.';});
 return {dispose(){disposed=true;cleanup();host.replaceChildren();}};
}
