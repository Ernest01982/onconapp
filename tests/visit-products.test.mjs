import test from 'node:test';
import assert from 'node:assert/strict';
import { addVisitProducts, applyVisitProductBatch, filterVisitProducts, toggleProductSelection, resolveDetectedVisitProducts } from '../visit-products.js';
import { applyVisitWineOutcomes } from '../domain.js';

const catalogue = [
  { id:'w1', name:'Chenin Blanc', brand:'Niew', sku:'A101', active:true },
  { id:'w2', name:'Rosé', brand:'Coastal', variety:'Pinotage', vintage:'2026', active:true },
  { id:'w3', name:'Merlot', brand:'Niew', active:true },
  { id:'retired', name:'Old wine', active:false }
];

test('select many products before adding, without duplicates or implicit outcome changes', () => {
  const original = [{wineId:'w1',outcome:'Interested',sampleLeft:true,notes:'Buyer likes it',followUpAt:'2026-11-01T07:00:00Z'}];
  const before = structuredClone(original);
  let selection = toggleProductSelection(new Set(), 'w2');
  selection = toggleProductSelection(selection, 'w3');
  assert.deepEqual([...selection], ['w2','w3']);
  const saved = addVisitProducts(original, ['w1','w2','w2','w3'], catalogue);
  assert.deepEqual(saved.map(item=>item.wineId), ['w1','w2','w3']);
  assert.deepEqual(saved[0], original[0]);
  assert.deepEqual(saved[1], {wineId:'w2',outcome:'Discussed',sampleLeft:false});
  assert.deepEqual(original, before);
  assert.deepEqual(addVisitProducts(saved, ['w1','w2','w3'], catalogue), saved);
  assert.deepEqual([...toggleProductSelection(selection,'w2')], ['w3']);
  assert.deepEqual([...selection], ['w2','w3']);
});

test('batch actions touch only selected fields and products and keep samples independent', () => {
  const original = [
    {wineId:'w1',outcome:'Listed',sampleLeft:true,notes:'Keep this note'},
    {wineId:'w2',outcome:'Considering',sampleLeft:false,allocation:'2 cases'},
    {wineId:'w3',outcome:'Discussed',sampleLeft:false}
  ];
  const before = structuredClone(original);
  const interested = applyVisitProductBatch(original, new Set(['w2','w3']), {outcome:'Interested'});
  assert.deepEqual(interested[0], original[0]);
  assert.equal(interested[1].outcome,'Interested');
  assert.equal(interested[1].allocation,'2 cases');
  const dropped = applyVisitProductBatch(interested, ['w2','w3','w2'], {sampleLeft:true});
  assert.equal(dropped[1].outcome,'Interested');
  assert.equal(dropped[1].sampleLeft,true);
  const tasted = applyVisitProductBatch(original, ['w3'], {outcome:'Sampled'});
  assert.equal(tasted[2].sampleLeft,false);
  const cleared = applyVisitProductBatch(dropped, ['w2'], {sampleLeft:false});
  assert.equal(cleared[1].sampleLeft,false);
  assert.equal(cleared[2].sampleLeft,true);
  assert.deepEqual(original,before);
  assert.deepEqual(applyVisitProductBatch(dropped,['w2','w3'],{sampleLeft:true}),dropped);
});

test('batch selection validates references before changing anything and keeps retired existing wines', () => {
  const original = [{wineId:'retired',outcome:'Listed',sampleLeft:false,notes:'Historical link'}];
  assert.deepEqual(addVisitProducts(original, ['retired'], catalogue),original);
  assert.throws(()=>addVisitProducts([],['retired'],catalogue),/no longer available/);
  assert.throws(()=>addVisitProducts(original,['w1','missing'],catalogue),/no longer available/);
  assert.throws(()=>applyVisitProductBatch(original,['missing'],{outcome:'Interested'}),/Add the selected/);
  assert.throws(()=>applyVisitProductBatch(original,[],{outcome:'Interested'}),/at least one/);
  assert.throws(()=>applyVisitProductBatch(original,['retired'],{}),/Choose an outcome/);
  assert.throws(()=>applyVisitProductBatch(original,['retired'],{outcome:'Delisted'}),/valid visit outcome/);
  assert.throws(()=>applyVisitProductBatch(original,['retired'],{sampleLeft:'yes'}),/whether samples/);
  assert.deepEqual(original,[{wineId:'retired',outcome:'Listed',sampleLeft:false,notes:'Historical link'}]);
});

test('product search handles accents, separate terms, SKU and vintage without losing selection', () => {
  assert.deepEqual(filterVisitProducts(catalogue,'  rose  2026 ').map(p=>p.id),['w2']);
  assert.deepEqual(filterVisitProducts(catalogue,'niew 101').map(p=>p.id),['w1']);
  assert.deepEqual(filterVisitProducts(catalogue,'pinotage').map(p=>p.id),['w2']);
  assert.equal(filterVisitProducts(catalogue,'old wine').length,0);
  assert.equal(filterVisitProducts(catalogue,'').length,3);
});

test('note-derived names never add the wrong pack variant or replace explicit product IDs', () => {
  const variants=[
    {id:'sku528',name:'River Red Shiraz/Pinotage',pack:'12 x 500ml',active:true},
    {id:'sku527',name:'River Red Shiraz/Pinotage',pack:'6 x 750ml',active:true},
    {id:'sku537',name:'River Red Shiraz/Pinotage',pack:'6 x 1500ml',active:true},
    ...catalogue
  ];
  const selected=[{wineId:'sku527',outcome:'Interested',sampleLeft:true,notes:'Correct 750ml product'}];
  const resolved=resolveDetectedVisitProducts(selected,['River Red Shiraz/Pinotage','ROSE','Old wine'],variants);
  assert.deepEqual(resolved,[...selected,{wineId:'w2',outcome:'Discussed',sampleLeft:false}]);
  assert.deepEqual(selected,[{wineId:'sku527',outcome:'Interested',sampleLeft:true,notes:'Correct 750ml product'}]);
  assert.deepEqual(resolveDetectedVisitProducts([],['River Red Shiraz/Pinotage'],variants),[]);
  assert.deepEqual(resolveDetectedVisitProducts(resolved,['ROSE','River Red Shiraz/Pinotage'],variants),resolved);
});

test('batch visit outcomes update existing restaurant-wine relationships without duplicates or inflated listings', () => {
  const workspace = {customerWines:[]};
  let wines = addVisitProducts([],['w1','w2'],catalogue);
  wines = applyVisitProductBatch(wines,['w1','w2'],{outcome:'Interested',sampleLeft:true});
  const visit = {id:'v1',customerId:'c1',end:'2026-10-21T12:00:00Z',wineOutcomes:wines};
  applyVisitWineOutcomes(workspace,visit);
  assert.equal(workspace.customerWines.length,2);
  assert.equal(workspace.customerWines.filter(r=>r.status==='Listed').length,0);
  const relationshipIds=workspace.customerWines.map(r=>r.id);
  visit.wineOutcomes=applyVisitProductBatch(wines,['w2'],{outcome:'Listed'});
  applyVisitWineOutcomes(workspace,{...visit,id:'v2'});
  assert.deepEqual(workspace.customerWines.map(r=>r.id),relationshipIds);
  assert.equal(workspace.customerWines.filter(r=>r.status==='Listed').length,1);
  assert.equal(workspace.customerWines.find(r=>r.wineId==='w1').status,'Interested');
});
