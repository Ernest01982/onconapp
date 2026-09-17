import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('cloud workflow preserves full notes, offline edits, new remote records and conflicts',async()=>{
  const tables=Object.fromEntries(['profiles','customers','visits','tasks','products','customer_wines','travel_trips','app_state'].map(t=>[t,[]]));
  let version=0;
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
        if(this.operation==='insert'){
          const key=this.row.id?'id':'user_id';
          if(rows.some(r=>r[key]===this.row[key]))return Promise.resolve({error:{message:'Duplicate'},data:null}).then(resolve,reject);
          result=[{...structuredClone(this.row),updated_at:'version-'+(++version)}];rows.push(...result);
        }
        if(this.operation==='update'){result=matches.map(r=>Object.assign(r,structuredClone(this.row),{updated_at:'version-'+(++version)}));}
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
  workspace.visits.push({id:'visit-1',customerId:'account-1',start:'2026-09-10T09:00:00Z',end:'2026-09-10T10:00:00Z',summary:'Short',rawNote:'First. Second. Important third commitment.'});
  assert.equal(await cloud.syncCloudNow(),true,status.error);
  assert.equal(tables.visits[0].raw_note,'First. Second. Important third commitment.');
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
});
