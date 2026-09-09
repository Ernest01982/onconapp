import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVisitWineOutcomes,
  calculateTripDistance,
  dateRange,
  normalizeWorkspace,
  taskBuckets,
  upsertCustomerWine
} from '../domain.js';

const base = () => ({ customers:[{id:'c1'}], products:[{id:'w1',name:'Wine One'}], visits:[], tasks:[], customerWines:[], travel:{ratePerKm:4.9,trips:[]} });

test('legacy workspaces gain additive fields without losing records', () => {
  const old = { customers:[{id:'c1'}], visits:[{id:'v1',products:['Wine One']}], tasks:[{id:'t1'}], travel:{trips:[{id:'r1',distanceKm:12,toCustomerId:'c1'}]} };
  const normalized = normalizeWorkspace(old, [{id:'w1',name:'Wine One'}]);
  assert.equal(normalized.customers[0].id, 'c1');
  assert.deepEqual(normalized.visits[0].wineOutcomes, [{wineId:'w1',outcome:'Discussed'}]);
  assert.equal(normalized.travel.trips[0].customerId, 'c1');
  assert.deepEqual(normalized.customerWines, []);
});

test('restaurant-wine updates never create duplicate relationships and retain history', () => {
  const data = base();
  upsertCustomerWine(data, {customerId:'c1',wineId:'w1',status:'Interested'}, '2026-09-01T09:00:00Z');
  upsertCustomerWine(data, {customerId:'c1',wineId:'w1',status:'Listed',allocation:'12 bottles'}, '2026-09-02T09:00:00Z');
  upsertCustomerWine(data, {customerId:'c1',wineId:'w1',status:'Delisted'}, '2026-09-03T09:00:00Z');
  assert.equal(data.customerWines.length, 1);
  assert.equal(data.customerWines[0].status, 'Delisted');
  assert.equal(data.customerWines[0].allocation, '12 bottles');
  assert.deepEqual(data.customerWines[0].history.map(item=>item.status), ['Interested','Listed','Delisted']);
  assert.equal(data.customerWines[0].listingDate, '2026-09-02T09:00:00Z');
  assert.equal(data.customerWines[0].delistingDate, '2026-09-03T09:00:00Z');
});

test('visit wine outcomes update the existing relationship', () => {
  const data = base();
  const first={id:'v1',customerId:'c1',end:'2026-09-01T09:00:00Z',wineOutcomes:[{wineId:'w1',outcome:'Interested'}]};
  const second={id:'v2',customerId:'c1',end:'2026-09-05T09:00:00Z',wineOutcomes:[{wineId:'w1',outcome:'Listed'}]};
  applyVisitWineOutcomes(data,first);
  applyVisitWineOutcomes(data,second);
  applyVisitWineOutcomes(data,{id:'v3',customerId:'c1',end:'2026-09-06T09:00:00Z',wineOutcomes:[{wineId:'w1',outcome:'Discussed'}]});
  assert.equal(data.customerWines.length,1);
  assert.equal(data.customerWines[0].status,'Listed');
  assert.equal(data.customerWines[0].history.at(-1).visitId,'v2');
});

test('odometer calculation rejects incomplete and impossible readings', () => {
  assert.deepEqual(calculateTripDistance({startOdometer:100,endOdometer:124.6}), {distanceKm:24.6,distanceSource:'odometer',startOdometer:100,endOdometer:124.6});
  assert.throws(()=>calculateTripDistance({startOdometer:100,endOdometer:''}), /both start and end/);
  assert.throws(()=>calculateTripDistance({startOdometer:100,endOdometer:99}), /cannot be lower/);
  assert.throws(()=>calculateTripDistance({manualDistance:-1}), /zero or more/);
});

test('follow-ups are grouped into overdue, today, upcoming and completed', () => {
  const reference=new Date('2026-09-09T12:00:00');
  const buckets=taskBuckets([
    {id:'a',due:'2026-09-08T09:00:00',done:false},
    {id:'b',due:'2026-09-09T09:00:00',done:false},
    {id:'c',due:'2026-09-10T09:00:00',done:false},
    {id:'d',due:'2026-09-07T09:00:00',done:true}
  ],reference);
  assert.equal(buckets.overdue[0].id,'a');
  assert.equal(buckets.today[0].id,'b');
  assert.equal(buckets.upcoming[0].id,'c');
  assert.equal(buckets.completed[0].id,'d');
});

test('report periods use a local inclusive start and exclusive end', () => {
  const range=dateRange('custom','2026-09-01','2026-09-03',new Date('2026-09-09T12:00:00'));
  assert.equal(range.start.getDate(),1);
  assert.equal(range.end.getDate(),4);
});
