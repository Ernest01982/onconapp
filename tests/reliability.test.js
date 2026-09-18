import test from 'node:test';
import assert from 'node:assert/strict';
import {draftVisitNote,questionScope,savedReimbursement} from '../reliability.js';

test('named-client scope, ambiguous names and unknown names never fall through to another client',()=>{
 const clients=[{id:'a',name:'Alpha Bistro'},{id:'b',name:'Beta Grill'}];
 assert.equal(questionScope('What happened at my last visit to Alpha Bistro?',clients).customer.id,'a');
 assert.ok(questionScope('Alpha Bistro and Beta Grill',clients).clarification);
 assert.ok(questionScope('What happened at my last visit to Unknown Cafe?',clients).clarification);
 assert.deepEqual(questionScope('What happened at my last visit?',clients),{});
 assert.equal(questionScope('alpha bistro follow-ups',clients).customer.id,'a');
});

test('notes retain selected wines and never infer confirmed listings or dates from prose',()=>{
 const wines=[{id:'p1',name:'Namaqua Cabernet Sauvignon'}];
 for(const note of ['The wine is not listed. No order agreed.','Listed last year but now delisted.','They might list it next week.','Placement confirmed. Call Friday.']){
  const draft=draftVisitNote(note,wines,{wineOutcomes:[{wineId:'p1',outcome:'Discussed'}]});
  assert.deepEqual(draft.products,['Namaqua Cabernet Sauvignon']);
  assert.equal(draft.feedbackOutcome,'General relationship visit');
  assert.equal(draft.followUp,null);
 }
 const explicit=draftVisitNote('Good meeting.',wines,{feedbackOutcome:'Listed / placement confirmed',nextAction:'Send prices',followUpRequired:true,followUpAt:'2026-10-01'});
 assert.equal(explicit.feedbackOutcome,'Listed / placement confirmed');
 assert.equal(explicit.nextAction,'Send prices');assert.equal(explicit.followUp,'2026-10-01');
 assert.equal(draftVisitNote('Do not send samples.',wines).nextAction,'');
});

test('saved mileage claim respects historical rates and zero reimbursement',()=>{
 assert.equal(savedReimbursement([{distanceKm:10,ratePerKm:3,reimbursement:30},{distanceKm:10,ratePerKm:4.9,reimbursement:49},{distanceKm:10,reimbursement:0}]),79);
});
