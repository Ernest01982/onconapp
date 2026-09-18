import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpContext,followUpMessage} from '../follow-up-actions.js';
import {normalizeWorkspace} from '../domain.js';
const fixture=()=>({profile:{name:'Test Rep'},customers:[{id:'a',name:'Alpha',contact:'Buyer A'}],products:[{id:'w',name:'Test Chardonnay'}],tasks:[{id:'t',customerId:'a',visitId:'v1',wineId:'w',contactPerson:'Manager M',reason:'Private negotiation'}],visits:[{id:'v1',customerId:'a',start:'2026-09-01',rawNote:'Private note'},{id:'v2',customerId:'a',start:'2026-09-18'},{id:'other',customerId:'b',start:'2026-09-19'}]});
test('follow-up selects linked visit before latest and never another client',()=>{
 const w=fixture();let c=followUpContext(w,'t');assert.equal(c.visit.id,'v1');assert.equal(c.linked,true);
 w.tasks[0].visitId='other';c=followUpContext(w,'t');assert.equal(c.visit.id,'v2');assert.equal(c.linked,false);
 w.visits=w.visits.filter(v=>v.customerId==='b');assert.equal(followUpContext(w,'t').visit,null);
 assert.equal(followUpContext(w,'missing'),null);
});
test('message uses specific task contact and wine but not private CRM notes or reasons',()=>{
 const w=fixture(),draft=followUpMessage(w,followUpContext(w,'t'));
 assert.match(draft.body,/Hi Manager/);assert.match(draft.body,/Test Chardonnay/);
 assert.doesNotMatch(draft.body,/Private|Buyer A/);assert.equal(draft.taskId,'t');
});
test('edited device draft survives workspace normalization and client reassignment cannot reuse it',()=>{
 const w=fixture();w.followUpMessageDrafts=[{taskId:'t',customerId:'a',subject:'Edited',body:'My message'}];
 const restored=normalizeWorkspace(JSON.parse(JSON.stringify(w)),w.products);
 assert.equal(followUpMessage(restored,followUpContext(restored,'t')).body,'My message');
 restored.tasks[0].customerId='different';assert.notEqual(followUpMessage(restored,followUpContext(restored,'t')).body,'My message');
 assert.equal(w.tasks[0].done,undefined);
});
