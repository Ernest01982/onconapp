import test from 'node:test';
import assert from 'node:assert/strict';
import {listingCycleReminders,normalizeWorkspace,planListingDateFollowUp,dateRange} from '../domain.js';
import {activityMetrics,formatTradeTime} from '../reporting.js';

test('expired windows become review exactly at 31 days and remain until an explicit date change',()=>{
 const c={id:'client',listingsReopenAt:'2026-08-01T09:00:00',listingReminderDays:60};
 const original=JSON.stringify(c);
 assert.equal(listingCycleReminders([c],new Date('2026-08-31T12:00:00'))[0].state,'open');
 assert.equal(listingCycleReminders([c],new Date('2026-09-01T00:00:00'))[0].state,'review');
 assert.equal(listingCycleReminders([c],new Date('2027-09-01T12:00:00'))[0].state,'review');
 assert.equal(JSON.stringify(c),original);
 const restored=normalizeWorkspace({customers:[c],visits:[],tasks:[]});
 assert.equal(listingCycleReminders(restored.customers,new Date('2026-09-19T12:00:00'))[0].state,'review');
 restored.customers[0].listingsReopenAt='2026-10-15T09:00:00';
 assert.equal(listingCycleReminders(restored.customers,new Date('2026-09-19T12:00:00'))[0].state,'due');
});

test('ask-again action uses existing follow-up fields without inventing dates or replacing details',()=>{
 const visit={id:'visit',customerId:'client',rawNote:'Original',contactSnapshot:{person:'Buyer'}};
 assert.equal(planListingDateFollowUp(visit),true);
 assert.equal(visit.followUpRequired,true);assert.equal(visit.followUpAt,undefined);
 assert.equal(visit.listingsReopenAt,undefined);assert.equal(visit.followUpContact,'Buyer');
 assert.equal(visit.id,'visit');assert.equal(visit.rawNote,'Original');
 visit.followUpAt='2026-09-30';visit.followUpReason='Existing reason';visit.nextAction='Existing action';
 planListingDateFollowUp(visit);assert.equal(visit.followUpAt,'2026-09-30');assert.equal(visit.followUpReason,'Existing reason');assert.equal(visit.nextAction,'Existing action');
 const known={menuChangeMonth:'2026-11'};assert.equal(planListingDateFollowUp(known),false);assert.deepEqual(known,{menuChangeMonth:'2026-11'});
});

test('reports format accumulated time in minutes rather than rounding to whole hours',()=>{
 for(const [input,expected] of [[0,'0 min'],[45,'45 min'],[60,'1h'],[75,'1h 15m'],[135,'2h 15m'],[59.6,'1h'],[-10,'0 min'],[NaN,'0 min']])assert.equal(formatTradeTime(input),expected);
});

test('selected-period activity uses actual completion dates; missing or invalid dates stay unknown',()=>{
 const range=dateRange('custom','2026-09-01','2026-09-30');
 const w={visits:[{id:'a',start:'2026-09-19T10:00:00',end:'2026-09-19T10:25:00'},{id:'b',start:'2026-09-19T11:00:00',end:'2026-09-19T11:20:00'},{id:'active',start:'2026-09-19T12:00:00'},{id:'old',start:'2026-08-31T10:00:00',end:'2026-08-31T11:00:00'}],travel:{trips:[]},tasks:[{id:'missing',done:true,due:'2026-09-05',completedAt:null},{id:'invalid',done:true,completedAt:'invalid'},{id:'before',done:true,due:'2026-09-05',completedAt:'2026-08-31T12:00:00'},{id:'within',done:true,due:'2026-08-30',completedAt:'2026-09-01T00:00:00'},{id:'after',done:true,completedAt:'2026-10-01T00:00:00'}]};
 const original=JSON.stringify(w),metrics=activityMetrics(w,range);
 assert.equal(metrics.minutes,45);assert.equal(metrics.visits.length,2);
 assert.deepEqual(metrics.tasksCompleted.map(t=>t.id),['within']);assert.equal(metrics.undatedCompleted,2);
 assert.equal(JSON.stringify(w),original);
});
