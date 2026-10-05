import test from 'node:test';
import assert from 'node:assert/strict';
import {businessDate,claimTrips,finishDay,navigationUrl,validateDay,reading} from '../daily-mileage.js';
import {activityMetrics} from '../reporting.js';
const now=new Date('2026-10-05T12:00:00Z');
const active={id:'day-2026-10-05',dailyLog:{date:'2026-10-05'},ratePerKm:4.9};
const input={startOdometer:'1000',endOdometer:'1120.5',privateKm:'20.5',purpose:'Client visits'};
test('daily odometer subtracts private KM and snapshots the rate without changing source',()=>{
 const day=finishDay(active,input,now);
 assert.equal(day.distanceKm,100);assert.equal(day.reimbursement,490);assert.equal(day.dailyLog.totalKm,120.5);assert.equal(day.customerId,null);assert.equal(active.end,undefined);
 assert.equal(finishDay({...active,ratePerKm:0},input,now).reimbursement,0);
});
test('daily readings reject negative, blank, nonfinite, reversed, excess private and future dates',()=>{
 for(const changes of [{endOdometer:'900'},{privateKm:'121'},{startOdometer:''},{privateKm:'-1'},{endOdometer:'Infinity'},{endOdometer:'1000.12'}])assert.throws(()=>finishDay(active,{...input,...changes},now));
 assert.throws(()=>validateDay('2026-02-30',now));assert.throws(()=>validateDay('2026-10-06',now));assert.throws(()=>reading(null,'reading'));
});
test('ZA dates, daily precedence and all report totals prevent duplicate claims',()=>{
 assert.equal(businessDate('2026-10-04T23:00:00Z'),'2026-10-05');
 assert.equal(businessDate('invalid'),'');assert.equal(claimTrips([{id:'legacy',start:'invalid'}]).length,1);
 const day=finishDay(active,input,now),support={id:'gps',start:'2026-10-05T08:00:00Z',distanceKm:40,reimbursement:196,customerId:'c'},previous={id:'previous',start:'2026-10-04T09:00:00Z',distanceKm:10,reimbursement:49};
 const trips=[support,day,previous];assert.deepEqual(claimTrips(trips),[day,previous]);assert.equal(trips.length,3);
 assert.equal(claimTrips([day,{...day,id:'duplicate'},support]).length,1);
 const metrics=activityMetrics({visits:[],tasks:[],travel:{trips}},{start:new Date('2026-10-04T22:00:00Z'),end:new Date('2026-10-05T22:00:00Z')});
 assert.equal(metrics.trips.length,1);assert.equal(metrics.trips[0].distanceKm,100);
});
test('navigation uses venue pin or encoded address, never sends CRM notes or contacts',()=>{
 const u=new URL(navigationUrl({lat:-34,lng:23,name:'Private',notes:'secret',phone:'123'}));assert.equal(u.searchParams.get('destination'),'-34,23');assert.equal(u.searchParams.get('travelmode'),'driving');assert.ok(!u.href.includes('secret'));
 const address=new URL(navigationUrl({name:"Moby's & Co",address:'Hop Street',area:'Plett'}));assert.match(address.searchParams.get('destination'),/Hop Street/);
 assert.equal(navigationUrl({name:'Unlocated',lat:null,lng:null}),null);
});
