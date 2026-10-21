import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {photoHash} from '../photo-local.js';

let sequence=0;
async function fixture(){
 const state={local:[],remote:[],objects:new Map(),calls:[],valid:true,failInsert:false,onDownload:null};
 const deps={photoHash,
  listPhotos:async(userId,customerId)=>structuredClone(state.local.filter(r=>r.userId===userId&&r.customerId===customerId)),
  putPhoto:async record=>{const other=state.local.find(r=>r.id!==record.id&&r.slot===record.slot&&r.customerId===record.customerId);if(other)throw Error('slot collision');const index=state.local.findIndex(r=>r.id===record.id&&r.userId===record.userId);if(index<0)state.local.push(structuredClone(record));else state.local[index]=structuredClone(record);},
  removePhoto:async(userId,id)=>{state.local=state.local.filter(r=>!(r.userId===userId&&r.id===id));},
  reassignPhotoSlots:async(userId,customerId,assignments)=>{state.calls.push('reassign');const updated=state.local.map(r=>r.userId===userId&&r.customerId===customerId?{...r,slot:assignments.find(a=>a.id===r.id)?.slot??r.slot}:r);assert.equal(new Set(updated.map(r=>r.slot)).size,updated.length);state.local=updated;}
 };
 const client={from(){let operation='read',row,filters=[];return {select(){return this;},eq(key,value){filters.push(r=>r[key]===value);return this;},order(){return this;},insert(value){operation='insert';row=value;return this;},delete(){operation='delete';return this;},then(resolve,reject){return Promise.resolve().then(()=>{state.calls.push(operation);if(operation==='insert'){if(state.failInsert){state.failInsert=false;return {error:{message:'network failed'}};}if(state.remote.some(r=>r.id===row.id||r.slot===row.slot))return {error:{message:'duplicate'}};state.remote.push({...row});}if(operation==='delete')state.remote=state.remote.filter(r=>!filters.every(f=>f(r)));return {data:state.remote.filter(r=>filters.every(f=>f(r))).map(r=>({...r})),error:null};}).then(resolve,reject);}};},storage:{from(){return {upload:async(path,blob)=>{state.calls.push('upload');if(state.objects.has(path))return {error:{message:'already exists'}};state.objects.set(path,blob);return {data:{path},error:null};},download:async path=>{state.calls.push('download');state.onDownload?.();return state.objects.has(path)?{data:state.objects.get(path),error:null}:{error:{message:'not found'}};},remove:async paths=>{paths.forEach(path=>state.objects.delete(path));return {data:[],error:null};}};}}};
 const a={userId:'owner',client,check(){if(!state.valid)throw Error('identity changed');}};
 const key='__photoCloudTest'+(++sequence);globalThis[key]=deps;
 const source=(await readFile(new URL('../photo-cloud.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,`const {listPhotos,putPhoto,removePhoto,photoHash,reassignPhotoSlots}=globalThis.${key};\n`);
 const cloud=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const photo=async(id,slot,verified=false)=>{const blob=new Blob([id],{type:'image/jpeg'});return {userId:'owner',id,customerId:'client',slot,verified,blob,sha256:await photoHash(blob),filename:id+'.jpg',capturedAt:'2026-10-21T12:00:00.000Z',visitId:'visit'};};
 const addRemote=record=>{state.remote.push({user_id:'owner',id:record.id,customer_id:'client',slot:record.slot,visit_id:record.visitId,filename:record.filename,captured_at:record.capturedAt,sha256:record.sha256,bytes:record.blob.size});state.objects.set('owner/'+record.id+'.jpg',record.blob);};
 return {state,a,cloud,photo,addRemote};
}

test('verified local photo missing cloud metadata is retained without resurrection',async()=>{
 const {state,a,cloud,photo}=await fixture();state.local.push(await photo('a',1,true));
 await assert.rejects(cloud.syncPhotoCopies(a,'client'),/missing from the cloud gallery/);
 assert.equal(state.local.length,1);assert.ok(!state.calls.includes('upload'));assert.equal(state.remote.length,0);
});

test('explicit sync reads previously verified objects and detects missing or changed bytes',async()=>{
 const {state,a,cloud,photo,addRemote}=await fixture();const record=await photo('a',1,true);state.local.push(record);addRemote(record);
 await cloud.syncPhotoCopies(a,'client');assert.equal(state.calls.filter(c=>c==='download').length,1);
 state.objects.delete('owner/a.jpg');await assert.rejects(cloud.syncPhotoCopies(a,'client'),/cloud photo could not be read/);
 assert.equal(state.local[0].blob.size,record.blob.size);assert.ok(!state.calls.includes('upload'));
 state.objects.set('owner/a.jpg',new Blob(['wrong'],{type:'image/jpeg'}));await assert.rejects(cloud.syncPhotoCopies(a,'client'),/readback did not match/);
});

test('metadata verification includes the linked visit',async()=>{
 const {state,a,cloud,photo,addRemote}=await fixture();const record=await photo('a',1,true);state.local.push(record);addRemote(record);state.remote[0].visit_id='different-visit';
 await assert.rejects(cloud.syncPhotoCopies(a,'client'),/differs between device and cloud/);assert.equal(state.local[0].visitId,'visit');
});

test('gallery caching remaps pending slots before saving cloud photos',async()=>{
 const {state,a,cloud,photo,addRemote}=await fixture();state.local.push(await photo('pending',1));addRemote(await photo('cloud',1));
 await cloud.cacheRemotePhotos(a,'client');assert.equal(state.local.length,2);assert.equal(state.local.find(r=>r.id==='pending').slot,2);assert.equal(state.local.find(r=>r.id==='cloud').slot,1);assert.equal(state.calls.filter(c=>c==='reassign').length,1);
});

test('restored photos with swapped slots reconcile atomically and verify without reupload',async()=>{
 const {state,a,cloud,photo,addRemote}=await fixture();const first=await photo('a',1),second=await photo('b',2);state.local.push(first,second);addRemote({...first,slot:2});addRemote({...second,slot:1});
 await cloud.syncPhotoCopies(a,'client');assert.deepEqual(state.local.map(r=>r.slot),[2,1]);assert.ok(state.local.every(r=>r.verified));assert.ok(!state.calls.includes('upload'));assert.equal(state.calls.filter(c=>c==='reassign').length,1);
});

test('interrupted metadata insertion retains bytes and retries the immutable upload safely',async()=>{
 const {state,a,cloud,photo}=await fixture();state.local.push(await photo('a',1));state.failInsert=true;
 await assert.rejects(cloud.syncPhotoCopies(a,'client'),/network failed/);assert.equal(state.objects.size,1);assert.equal(state.remote.length,0);assert.equal(state.local[0].verified,false);
 await cloud.syncPhotoCopies(a,'client');assert.equal(state.objects.size,1);assert.equal(state.remote.length,1);assert.equal(state.local[0].verified,true);
});

test('identity changes after download prevent local verified mutations',async()=>{
 const {state,a,cloud,photo,addRemote}=await fixture();const record=await photo('a',1);state.local.push(record);addRemote(record);state.onDownload=()=>{state.valid=false;};
 await assert.rejects(cloud.syncPhotoCopies(a,'client'),/identity changed/);assert.equal(state.local[0].verified,false);
});
