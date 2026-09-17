import test from 'node:test';
import assert from 'node:assert/strict';
import { realProducts, PRICE_LIST_DATE } from '../products-data.js';
import { normalizeWorkspace } from '../domain.js';
import { mergeCatalogue } from '../catalogue.js';

test('August catalogue has unique IDs and aliases, valid prices and historical records', () => {
  assert.equal(PRICE_LIST_DATE, '1 August 2026');
  assert.equal(realProducts.filter(p => p.active).length, 292);
  assert.equal(realProducts.filter(p => !p.active).length, 7);
  assert.equal(new Set(realProducts.map(p => p.id)).size, 299);
  assert.equal(new Set(realProducts.map(p => p.sku)).size, 299);
  for (const p of realProducts.filter(p => p.active)) {
    assert.ok(Number.isFinite(p.price) && p.price >= 0);
    assert.ok(Number.isFinite(p.unitPrice) && p.unitPrice >= 0);
    assert.ok(!p.priceIndicator.includes('#'));
  }
  assert.equal(realProducts.find(p => p.id === 'p52').price, 1418.64);
  assert.equal(realProducts.find(p => p.id === 'p52').unitPrice, 236.44);
  assert.equal(realProducts.find(p => p.id === 'p94').unitPrice, 241.5);
  assert.equal(realProducts.find(p => p.id === 'p95').unitPrice, 74.75);
  assert.equal(realProducts.find(p => p.sku === 'LXCHRRY').availability, 'Discontinued — remaining stock only');
  assert.equal(realProducts.find(p => p.sku === 'LAGER').availability, 'Confirm availability');
});

test('saved or cloud catalogue upgrades without changing relationship IDs or duplicating wines', () => {
  const original = {
    products:[{id:'custom-london',sku:'LONDON',price:1533.13},{id:'p5',sku:'NAM-5'}, {id:'p24',sku:'VINCHA'}, {id:'own',sku:'CUSTOM',price:10}],
    visits:[{id:'v1',wineOutcomes:[{wineId:'custom-london',outcome:'Listed'}]}],
    customerWines:[{id:'r1',customerId:'c1',wineId:'custom-london',status:'Listed',createdAt:'2026-08-01',updatedAt:'2026-08-01'}]
  };
  const upgraded = normalizeWorkspace(original, realProducts);
  assert.equal(upgraded.products.find(p => p.id === 'custom-london').price, 1418.64);
  assert.equal(upgraded.products.filter(p => p.sku === 'LONDON').length, 1);
  assert.equal(upgraded.products.find(p => p.id === 'p5').sku, 'NAMCB01');
  assert.equal(upgraded.products.find(p => p.id === 'p24').active, false);
  assert.equal(upgraded.products.find(p => p.id === 'own').price, 10);
  assert.equal(upgraded.customerWines[0].wineId, 'custom-london');
  assert.equal(upgraded.visits[0].wineOutcomes[0].wineId, 'custom-london');
  assert.deepEqual(normalizeWorkspace(upgraded, realProducts), upgraded);
  assert.equal(original.products[0].price, 1533.13);
  assert.deepEqual(mergeCatalogue(upgraded.products, realProducts), upgraded.products);
});
