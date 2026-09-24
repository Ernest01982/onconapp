import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('paused imports retain auth listeners and only retry on explicit Sync now',async()=>{
  let listener,attempts=0,status;
  const session={user:{id:'paused-owner',email:'test@example.invalid'}};
  globalThis.__pausedImportClient={from(){throw new Error('No CRM request is allowed before import confirmation');},auth:{getSession:async()=>({data:{session}}),onAuthStateChange:callback=>{listener=callback;}}};
  const source=(await readFile(new URL('../cloud.js',import.meta.url),'utf8'))
    .replace("from './sync-safety.js'",'from '+JSON.stringify(new URL('../sync-safety.js',import.meta.url).href))
    .replace("import { createClient } from '@supabase/supabase-js';","const createClient=()=>globalThis.__pausedImportClient;")
    .replace('import.meta.env.VITE_SUPABASE_URL',"'https://test.invalid'")
    .replace('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY',"'test-key'");
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  const cloud=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  await cloud.initializeCloud({getData:()=>({}),setData:()=>assert.fail('must not replace local data'),onIdentityChange:()=>{attempts++;throw new Error('Backup confirmation needed');},onStatus:value=>{status=value;}});
  assert.equal(attempts,1);assert.equal(typeof listener,'function');assert.match(status.error,/Backup/);
  listener('INITIAL_SESSION',session);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(attempts,1);assert.match(status.error,/Backup/);
  assert.equal(await cloud.refreshCloud(),false);assert.equal(attempts,2);
});

test('cloud workflow preserves full notes, offline edits, new remote records and conflicts',async()=>{
  const tables=Object.fromEntries(['profiles','customers','visits','tasks','products','customer_wines','travel_trips','app_state'].map(t=>[t,[]]));
  let version=0;
  let corruptAfterVisitWrite=false, corruptNextVisitRead=false;
  let editDuringStateWrite=null;
  const calls=[];
  class Query {
    constructor(table){this.table=table;this.filters=[];this.operation='read';}
    select(){return this;} order(){return this;} range(){return this;}
    eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    maybeSingle(){this.single=true;return this;}
    insert(row){this.operation='insert';this.row=row;return this;}
    update(row){this.operation='update';this.row=row;return this;}
    delete(){this.operation='delete';return this;}
    then(resolve,reject){
      try {
        const rows=tables[this.table],matches=rows.filter(r=>this.filters.every(f=>f(r)));
        calls.push({table:this.table,operation:this.operation});
        let result;
        if(this.operation==='read')result=matches;
        if(this.operation==='read' && this.table==='visits' && corruptNextVisitRead){result=matches.map(r=>({...r,raw_note:'Incorrect readback'}));corruptNextVisitRead=false;}
        if(this.operation==='insert'){
          const key=this.row.id?'id':'user_id';
          if(rows.some(r=>r[key]===this.row[key]))return Promise.resolve({error:{message:'Duplicate'},data:null}).then(resolve,reject);
          result=[{...structuredClone(this.row),updated_at:'version-'+(++version)}];rows.push(...result);
        }
        if(this.operation==='update'){result=matches.map(r=>Object.assign(r,structuredClone(this.row),{updated_at:'version-'+(++version)}));}
        if(this.operation==='update' && this.table==='visits' && corruptAfterVisitWrite)corruptNextVisitRead=true;
        if(this.operation==='update' && this.table==='app_state' && editDuringStateWrite){const edit=editDuringStateWrite;editDuringStateWrite=null;edit();}
        if(this.operation==='delete'){result=matches;tables[this.table]=rows.filter(r=>!matches.includes(r));}
        return Promise.resolve({data:structuredClone(this.single?result[0]||null:result),error:null}).then(resolve,reject);
      }catch(error){return Promise.reject(error).then(resolve,reject);}
    }
  }
  globalThis.__cloudTestClient={from:t=>new Query(t),auth:{getSession:async()=>({data:{session:{user:{id:'owner',email:'pilot@example.com'}}}}),onAuthStateChange:()=>{}}};
  const source=(await readFile(new URL('../cloud.js',import.meta.url),'utf8'))
    .replace("from './sync-safety.js'",'from '+JSON.stringify(new URL('../sync-safety.js',import.meta.url).href))
    .replace("import { createClient } from '@supabase/supabase-js';","const createClient=()=>globalThis.__cloudTestClient;")
    .replace('import.meta.env.VITE_SUPABASE_URL',"'https://test.invalid'")
    .replace('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY',"'test-key'");
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  const cloud=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let workspace={profile:{name:'Pilot',initials:'P',territory:'Test'},customers:[],visits:[],products:[],tasks:[],customerWines:[],travel:{ratePerKm:4.9,trips:[],activeTrip:null,lastPosition:null},activeVisit:null,chat:[]};
  let status;
  await cloud.initializeCloud({getData:()=>workspace,setData:value=>{workspace={...workspace,...value};},onStatus:value=>{status=value;}});
  assert.equal(tables.profiles.length,1);
  workspace.profile={name:'Updated Rep',initials:'UR',territory:'New Territory'};
  workspace.travel.ratePerKm=5.25;
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.profiles[0].display_name,'Updated Rep');
  assert.equal(tables.profiles[0].territory,'New Territory');
  assert.equal(tables.profiles[0].rate_per_km,5.25);
  workspace.customers.push({id:'account-1',name:'A',area:'Test',type:'Restaurant'});
  workspace.visits.push({id:'visit-1',customerId:'account-1',start:'2026-09-10T09:00:00Z',end:'2026-09-10T10:00:00Z',summary:'Short',rawNote:'First. Second. Important third commitment.',feedbackOutcome:'Not doing listings now / No current listing opportunity',menuChangeDate:null,listingsReopenAt:null,followUpRequired:true,followUp:'2026-09-30T07:00:00Z',followUpReason:'Ask when menu or wine listings reopen',followUpContact:'Buyer',followUpTaskId:'task-ask-again'});
  workspace.tasks.push({id:'task-ask-again',customerId:'account-1',visitId:'visit-1',title:'Ask when menu or wine listings reopen',reason:'Ask when menu or wine listings reopen',contactPerson:'Buyer',due:'2026-09-30T07:00:00Z',done:false});
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.visits[0].raw_note,'First. Second. Important third commitment.');
  assert.equal(tables.visits[0].menu_change_date,null);
  assert.equal(tables.visits[0].listings_reopen_at,null);
  assert.equal(tables.visits[0].follow_up_task_id,'task-ask-again');
  assert.equal(tables.tasks[0].visit_id,'visit-1');
  assert.equal(await cloud.refreshCloud(),true,status.error);
  assert.equal(workspace.visits[0].listingsReopenAt,null);
  assert.equal(workspace.visits[0].followUpReason,'Ask when menu or wine listings reopen');
  assert.equal(workspace.visits[0].followUpContact,'Buyer');
  assert.equal(workspace.visits[0].followUpTaskId,workspace.tasks[0].id);
  assert.equal(workspace.tasks[0].due,'2026-09-30T07:00:00Z');
  assert.equal(status.verifiedCounts.visits,1);
  const verifiedBefore=status.lastSynced;
  corruptAfterVisitWrite=true;
  workspace.visits[0].rawNote='Keep my complete device note';
  assert.equal(await cloud.syncCloudNow(),false);
  assert.match(status.error,/verification failed/);
  assert.equal(status.lastSynced,verifiedBefore);
  assert.equal(workspace.visits[0].rawNote,'Keep my complete device note');
  corruptAfterVisitWrite=false;
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.visits.length,1);
  assert.equal(status.pendingChanges,false);
  const noWrites=calls.length;
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(calls.slice(noWrites).filter(c=>c.operation!=='read').length,0);
  workspace.visits[0].rawNote+=' Offline change.';
  tables.customers.push({...tables.customers[0],id:'account-2',name:'Cloud account',updated_at:'extra'});
  assert.equal(await cloud.refreshCloud(),true,status.error);
  assert.equal(workspace.customers.length,2);
  assert.match(tables.visits[0].raw_note,/Offline change/);
  workspace.visits[0].rawNote='Device correction';
  tables.visits[0].raw_note='Cloud correction';tables.visits[0].updated_at='remote-new';
  assert.equal(await cloud.syncCloudNow(),false);
  assert.match(status.error,/different cloud copy/);
  assert.equal(tables.visits[0].raw_note,'Cloud correction');
  assert.equal(workspace.visits[0].rawNote,'Device correction');
  const differences=await cloud.reviewCloudDifferences();
  assert.equal(differences.length,1);
  await cloud.resolveCloudDifference(differences[0].token,'device');
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.visits[0].raw_note,'Device correction');
  workspace.visits=[];
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.visits.length,0);
  assert.equal(tables.customers.length,2);
  const history=[{id:'email-1',emailMarkedSent:true,markedAt:'2026-09-17T12:00:00Z',customerId:'account-1',visitId:'visit-1',to:'buyer@example.com'}];
  workspace.customers.find(c=>c.id==='account-1').emailFollowUps=history;
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.deepEqual(tables.customers.find(c=>c.id==='account-1').email_follow_ups,history);
  assert.equal(await cloud.refreshCloud(),true,status.error);
  assert.deepEqual(workspace.customers.find(c=>c.id==='account-1').emailFollowUps,history);
  // Simulate a browser closing after acknowledgements but before verification.
  workspace._syncPendingBase=structuredClone(workspace._syncBase);
  workspace.visits.push({id:'interrupted',customerId:'account-1',start:'2026-09-18T09:00:00Z',end:'2026-09-18T10:00:00Z',rawNote:'Must survive interrupted verification'});
  workspace._syncBase.visits.interrupted={fingerprint:'unverified',version:'unverified'};
  assert.equal(await cloud.refreshCloud(),true,status.error);
  assert.equal(workspace.visits[0].id,'interrupted');
  assert.equal(tables.visits.filter(v=>v.id==='interrupted').length,1);
  assert.equal(workspace._syncPendingBase,undefined);
  // Changes typed while a snapshot uploads remain visibly pending.
  workspace.chat.push({role:'user',text:'Trigger state write'});
  editDuringStateWrite=()=>{workspace.profile.territory='Edited during verification';};
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(status.pendingChanges,true);
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(status.pendingChanges,false);
});
