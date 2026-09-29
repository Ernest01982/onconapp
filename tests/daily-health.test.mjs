import test from 'node:test';
import assert from 'node:assert/strict';
import {roundDecimal,canonicalTripRow,upgradeReliabilityBaselines,fingerprint,syncDecision} from '../sync-safety.js';
import {correctVisitTime,visitNeedsReview,dailyHealth,contactFor,csvDocument} from '../daily-health.js';
import {managementCsv,localDateTime} from '../upgrade-ui.js';
const now=new Date('2026-09-29T16:00:00Z');
test('decimal rules match persisted precision, preserve zero and never change notes',()=>{
 assert.equal(roundDecimal(12.3*4.9,2),60.27);assert.equal(roundDecimal(1.005,2),1.01);assert.equal(roundDecimal(1e-7,3),0);
 const row=canonicalTripRow({distance_km:12.345678,rate_per_km:0,reimbursement:60.27000000000001,notes:'Original',points:[{lat:1.2345678}],start_odometer:null});
 assert.deepEqual(row,{distance_km:12.346,rate_per_km:0,reimbursement:60.27,notes:'Original',points:[{lat:1.2345678}],start_odometer:null});
 assert.throws(()=>roundDecimal(Infinity));
});
test('baseline compatibility extends only history and keeps genuine remote edits protected',()=>{
 const raw={id:'t',user_id:'u',distance_km:12.345678,reimbursement:12.3*4.9,notes:'before'};
 const workspace={_syncBase:{travel_trips:{t:{fingerprint:fingerprint(raw),version:'v1'}}}};
 upgradeReliabilityBaselines(workspace);const base=workspace._syncBase.travel_trips.t;
 const unchanged={...canonicalTripRow(raw),recording_flags:[]};
 assert.equal(base.fingerprint,fingerprint(unchanged));assert.equal(base.version,'v1');
 assert.equal(syncDecision(unchanged,{row:{...unchanged,notes:'cloud'},version:'v2'},base),'remote');
 assert.equal(syncDecision({...unchanged,notes:'phone'},{row:{...unchanged,notes:'cloud'},version:'v2'},base),'conflict');
 const corrupt={_syncBase:{visits:{x:{fingerprint:'bad',version:'keep'}}}};upgradeReliabilityBaselines(corrupt);assert.equal(corrupt._syncBase.visits.x.fingerprint,'bad');
});
test('visit corrections require valid confirmed times and preserve full audit history',()=>{
 const v={id:'v',start:'2026-09-28T10:00:00.123Z',end:'2026-09-29T08:00:00.456Z',rawNote:'Keep'};
 assert.equal(visitNeedsReview(v,now),true);
 const x=correctVisitTime(v,{start:v.start,end:'2026-09-28T11:00:00Z',reason:'Forgot timer',actor:'Rep'},now);
 assert.equal(x.timeCorrections[0].before.end,v.end);assert.equal(x.rawNote,'Keep');assert.equal(v.timeCorrections,undefined);
 assert.throws(()=>correctVisitTime(v,{start:v.start,end:'2026-09-28T11:00:00Z',reason:''},now));
 assert.throws(()=>correctVisitTime(v,{start:v.start,end:'2026-10-01',reason:'bad'},now));
 assert.equal(correctVisitTime(v,{start:v.start,end:v.end},now),v);
 assert.equal(new Date(localDateTime(v.start)).getTime(),new Date(v.start).getTime());
});
test('additional contact is explicit and never falls back to primary details',()=>{
 const c={id:'c',name:'Venue',contact:'Primary',email:'primary@example.com',phone:'0821234567',additionalContact:'Other',additionalEmail:'other@example.com'};
 assert.equal(contactFor(c).email,c.email);assert.equal(contactFor(c,'additional').email,'other@example.com');assert.equal(contactFor(c,'additional').phone,'');assert.equal(c.contact,'Primary');
});
test('health flags missing contact/cycle and unfinished GPS evidence without inventing records',()=>{
 const w={customers:[{id:'c'}],visits:[],tasks:[{id:'t',due:'2026-09-01',done:false}],travel:{trips:[{id:'r',distanceSource:'gps',recordingFlags:['gap']}]}};
 const result=dailyHealth(w,now);assert.equal(result.missingContact.length,1);assert.equal(result.missingCycle.length,1);assert.equal(result.overdue.length,1);assert.equal(result.flaggedTrips.length,1);
});
test('CSV exports keep all listings and protect text cells from spreadsheet formulas',()=>{
 const w={profile:{name:'Rep',territory:'Test'},customers:[{id:'c',name:'=2+2'}],visits:[],tasks:[],customerWines:Array.from({length:8},(_,i)=>({id:'r'+i,customerId:'c',wineId:'w',status:'Listed'})),products:[{id:'w',name:'Wine'}],travel:{trips:[],ratePerKm:4.9}};
 const csv=managementCsv(w,{start:new Date('2026-09-01'),end:new Date('2026-10-01'),label:'September'});
 assert.ok(csv.includes('"r7"'));assert.ok(csv.includes('"\'=2+2"'));assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csvDocument([['@SUM(A1)','line\n"quoted"']]),/"'@SUM/);
});
