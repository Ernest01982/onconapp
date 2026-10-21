import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addVisitProducts, applyVisitProductBatch } from '../visit-products.js';

// Focused source-wiring tests, not a browser/mobile-layout test. Execute the
// application's actual action bodies with an isolated in-memory workspace.
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function actionBody(name) {
  const start = source.indexOf(`else if(action==='${name}')`);
  assert.notEqual(start,-1,`Action ${name} exists`);
  const next = source.indexOf('\n  else if(',start+1);
  const block = source.slice(start,next<0?source.length:next);
  return block.slice(block.indexOf('{')+1,block.lastIndexOf('}'));
}
function invoke(name,env) {
  // The code is from this repository, not user data; real browser/network
  // dependencies are replaced by the supplied test environment.
  return new Function('env',`with(env) { ${actionBody(name)} }`)(env);
}
function fixture() {
  const env={
    data:{products:[{id:'old',active:true},{id:'new',active:true}],activeVisit:{id:'v1',customerId:'c1',wineOutcomes:[{wineId:'old',outcome:'Listed',sampleLeft:true,notes:'Keep'}]}},
    productSelection:new Set(['new']),batchSelection:new Set(),modal:'product-picker',
    addVisitProducts,applyVisitProductBatch,clone:structuredClone,
    saveCount:0,renderCount:0,messages:[],
    save(){env.saveCount++;},render(){env.renderCount++;},toast(message){env.messages.push(message);},
    document:{getElementById(id){return {value:id==='batch-outcome'?'Interested':''};}}
  };
  return env;
}

test('source-wiring: Add selected saves once and preselects new products for later outcome changes',()=>{
  const env=fixture();invoke('add-selected-products',env);
  assert.equal(env.saveCount,1);assert.equal(env.renderCount,1);
  assert.deepEqual(env.data.activeVisit.wineOutcomes,[
    {wineId:'old',outcome:'Listed',sampleLeft:true,notes:'Keep'},
    {wineId:'new',outcome:'Discussed',sampleLeft:false}
  ]);
  assert.deepEqual([...env.batchSelection],['new']);
  assert.equal(env.productSelection.size,0);assert.equal(env.modal,null);
});

test('source-wiring: failed multi-add restores visit and keeps the picker selection for retry',()=>{
  const env=fixture(),before=structuredClone(env.data);
  env.save=()=>{throw new Error('Storage full');};
  invoke('add-selected-products',env);
  assert.deepEqual(env.data,before);
  assert.deepEqual([...env.productSelection],['new']);
  assert.equal(env.modal,'product-picker');assert.equal(env.renderCount,0);
  assert.match(env.messages.at(-1),/Storage full/);
});

test('source-wiring: batch action changes selected outcomes only and rolls back failed saves',()=>{
  const env=fixture();invoke('add-selected-products',env);
  invoke('apply-product-batch',env);
  assert.equal(env.data.activeVisit.wineOutcomes[0].outcome,'Listed');
  assert.equal(env.data.activeVisit.wineOutcomes[0].notes,'Keep');
  assert.equal(env.data.activeVisit.wineOutcomes[1].outcome,'Interested');
  assert.equal(env.data.activeVisit.wineOutcomes[1].sampleLeft,false);
  const before=structuredClone(env.data);
  env.document.getElementById=id=>({value:id==='batch-outcome'?'Sampled':'yes'});
  env.save=()=>{throw new Error('Storage full');};
  invoke('apply-product-batch',env);
  assert.deepEqual(env.data,before);assert.match(env.messages.at(-1),/Storage full/);
});

test('source-invariant: multi-picker retains individual controls and selection survives search',()=>{
  assert.match(source,/if\(mode==='visit'\)\{multiProductPicker\(\);return;\}/);
  assert.match(source,/data-picker-wine=/);
  assert.match(source,/data-batch-wine=/);
  assert.match(source,/data-visit-wine-outcome=/);
  assert.match(source,/data-visit-wine-sample=/);
  const searchHandler=source.match(/if\(event\.target\.id==='wine-picker-search'\)\{([^\n]+)\}/)?.[1]||'';
  assert.match(searchHandler,/winePickerModal/);
  assert.doesNotMatch(searchHandler,/productSelection\s*=|productSelection\.clear/);
  assert.match(source,/samplesLeftWineIds:selected\.filter\(item=>item\.sampleLeft\)\.map\(item=>item\.wineId\)/);
});
