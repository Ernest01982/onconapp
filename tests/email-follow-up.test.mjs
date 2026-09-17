import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmailFollowUp,followUpMailto,markEmailFollowUpSent,validContactEmail} from '../email-follow-up.js';
const customer={id:'qa',name:"O'Connor's Café & Grill",contact:'Quinton Smith',email:'quinton+sales@example.com'};
const products=[{id:'wine1',name:'Sauvignon Blanc'},{id:'wine2',name:'Chenin Blanc'}];
const visit={id:'visit',customerId:'qa',start:'2026-09-17T10:00:00Z',products:['Sauvignon Blanc'],wineOutcomes:[{wineId:'wine1',outcome:'Interested'},{wineId:'wine2',outcome:'Sampled',sampleLeft:true}],rawNote:'Internal margin discussion. I will bring Chenin samples next week. Buyer sampled Sauvignon.',nextAction:'Send prices & arrange tasting.',followUp:'2026-09-25'};
const now=new Date('2026-09-17T12:00:00Z');
test('contextual draft has correctly encoded recipient, subject, line breaks and special characters',()=>{
 const draft=buildEmailFollowUp({customer,visit,products,profile:{name:'Ernest Reyneke'},now});
 const url=new URL(followUpMailto(draft));
 assert.equal(decodeURIComponent(url.pathname),customer.email);
 assert.equal(url.searchParams.get('subject'),"Namaqua Wines Follow-up - O'Connor's Café & Grill");
 assert.match(draft.body,/Hi Quinton,/);
 assert.match(draft.body,/see me today/);
 assert.match(draft.body,/Wines of interest:\n- Sauvignon Blanc/);
 assert.match(draft.body,/Samples left:\n- Chenin Blanc/);
 assert.match(draft.body,/Samples promised:\nI will bring Chenin samples next week/);
 assert.match(draft.body,/Send prices & arrange tasting/);
 assert.match(draft.body,/25 Sept? 2026/);
 assert.match(draft.body,/Ernest Reyneke\nNamaqua Wines/);
 assert.doesNotMatch(draft.body,/Internal margin/);
 assert.ok(url.searchParams.get('body').includes('\r\n'));
});
test('missing or invalid addresses fail closed, including header/recipient injection',()=>{
 for(const email of ['', 'bad', 'x@example.com\nbcc:spy@example.com','x@example.com,spy@example.com','x@example.com?bcc=spy@example.com']){
  assert.equal(validContactEmail(email),false);
  assert.throws(()=>buildEmailFollowUp({customer:{...customer,email},now}));
 }
});
test('minimal draft has no empty headings, invented visit or sample promise',()=>{
 const draft=buildEmailFollowUp({customer:{...customer,contact:''},now});
 assert.match(draft.body,/Hi,/);
 assert.doesNotMatch(draft.body,/Wines discussed|Samples|Next step|see me today|undefined|null/);
});
test('closed listing window is non-pushy and existing listings are not treated as first introductions',()=>{
 const draft=buildEmailFollowUp({customer,visit:{...visit,feedbackOutcome:'Not doing listings now / No current listing opportunity'},products,now});
 assert.match(draft.body,/not reviewing new listings/);
 const listed=buildEmailFollowUp({customer,visit,products,relationships:[{customerId:'qa',wineId:'wine1',status:'Listed'}],now});
 assert.match(listed.body,/continued support/);
 assert.match(listed.body,/Currently listed/);
});
test('old visits and rescheduled/completed follow-ups use accurate date wording',()=>{
 const old={...visit,start:'2026-09-01T10:00:00Z',followUp:'2026-09-05'};
 const draft=buildEmailFollowUp({customer,visit:old,products,now});
 assert.doesNotMatch(draft.body,/see me today/);
 assert.match(draft.body,/recorded follow-up date was/);
 const changed=buildEmailFollowUp({customer,visit:old,products,task:{due:'2026-09-30'},now});
 assert.match(changed.body,/30 Sept? 2026/);
 const done=buildEmailFollowUp({customer,visit:old,products,task:{done:true,due:'2026-09-30'},now});
 assert.doesNotMatch(done.body,/back in touch on|recorded follow-up date/);
});
test('sampled, left, negated or speculative notes never turn into promises',()=>{
 for(const rawNote of ['Samples left with buyer.','No samples promised.','I will not bring samples.','Buyer might ask for samples.']){
 const draft=buildEmailFollowUp({customer,visit:{...visit,rawNote},products,now});
 assert.doesNotMatch(draft.body,/Samples promised:/);
 }
});
test('manual marking is idempotent, persists links, and does not create visits/tasks',()=>{
 const workspace={customers:[{...customer}],visits:[visit],tasks:[]};
 const draft={...buildEmailFollowUp({customer,visit,products,now}),id:'draft-1'};
 assert.equal(workspace.customers[0].emailFollowUps,undefined);
 const event=markEmailFollowUpSent(workspace,draft,'2026-09-17T12:00:00Z');
 markEmailFollowUpSent(workspace,draft,'2026-09-18T12:00:00Z');
 assert.equal(workspace.customers[0].emailFollowUps.length,1);
 assert.equal(event.emailMarkedSent,true);assert.equal(event.markedAt,'2026-09-17T12:00:00Z');
 assert.equal(event.visitId,visit.id);assert.equal(event.customerId,customer.id);
 const restored=JSON.parse(JSON.stringify(workspace));
 markEmailFollowUpSent(restored,draft);
 assert.equal(restored.customers[0].emailFollowUps.length,1);
 assert.equal(workspace.visits.length,1);assert.equal(workspace.tasks.length,0);
});
