import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOMER_FIELD_LIMITS, normalizeCustomerFields, upgradeCustomerFieldBaselines } from '../customer-fields.js';
import { fingerprint, syncDecision, mergeRecords } from '../sync-safety.js';

const defaults = {preferred_supplier:'',additional_contact:'',additional_phone:'',additional_email:''};
const oldRow = {id:'client-1',user_id:'owner',name:'Test venue',contact_name:'Original buyer',phone:'0821234567'};
const oldBase = () => ({fingerprint:fingerprint(oldRow),version:'original-version',preserve:'metadata'});

test('optional customer fields default without changing existing contact or truncating text', () => {
  const original = {id:'client-1',name:'Test venue',contact:'Primary buyer',phone:'0821234567',email:'primary@example.invalid',preferredSupplier:'  Supplier '+ 'x'.repeat(220),additionalContact:'Second buyer',additionalPhone:'',additionalEmail:'second@example.invalid',history:[{id:'history-1'}]};
  const before = structuredClone(original), normalized = normalizeCustomerFields(original);
  assert.deepEqual(original, before);
  assert.deepEqual(normalized, original);
  assert.notEqual(normalized, original);
  assert.deepEqual(normalizeCustomerFields({id:'old'}),{id:'old',preferredSupplier:'',additionalContact:'',additionalPhone:'',additionalEmail:''});
  assert.equal(normalizeCustomerFields({additionalPhone:123}).additionalPhone,'123');
  assert.deepEqual(CUSTOMER_FIELD_LIMITS,{preferredSupplier:200,additionalContact:120,additionalPhone:40,additionalEmail:254});
});

test('v20 current and interrupted customer baselines gain only missing columns, idempotently', () => {
  const workspace = {customers:[{id:'client-1',preferredSupplier:'New unsynced supplier'}],_syncBase:{customers:{'client-1':oldBase()},visits:{v:{fingerprint:'visit-preserved',version:'v1'}}},_syncPendingBase:{customers:{'client-1':{...oldBase(),fingerprint:fingerprint({...oldRow,additional_contact:'Saved secondary',additional_email:null})}}}};
  const originalCustomers=structuredClone(workspace.customers);
  assert.equal(upgradeCustomerFieldBaselines(workspace),workspace);
  assert.deepEqual(workspace._syncBase.customers['client-1'],{...oldBase(),fingerprint:fingerprint({...oldRow,...defaults})});
  assert.deepEqual(JSON.parse(workspace._syncPendingBase.customers['client-1'].fingerprint),JSON.parse(fingerprint({...oldRow,...defaults,additional_contact:'Saved secondary',additional_email:null})));
  assert.deepEqual(workspace._syncBase.visits,{v:{fingerprint:'visit-preserved',version:'v1'}});
  assert.deepEqual(workspace.customers,originalCustomers);
  const once=JSON.stringify(workspace);upgradeCustomerFieldBaselines(workspace);assert.equal(JSON.stringify(workspace),once);
});

test('invalid, noncanonical, unrelated and unidentifiable baseline fingerprints stay unchanged', () => {
  for (const value of ['unverified','null','[]','{}','42',JSON.stringify(oldRow),fingerprint({...oldRow,id:'other'}),fingerprint({id:'client-1',name:'missing owner'})]) {
    const workspace={_syncBase:{customers:{'client-1':{fingerprint:value,version:'kept'}}},_syncPendingBase:{customers:[]}};
    const before=JSON.stringify(workspace);upgradeCustomerFieldBaselines(workspace);assert.equal(JSON.stringify(workspace),before,value);
  }
  for(const value of [null,undefined,[],{}, {_syncBase:null},{_syncBase:{customers:{bad:null}}}])assert.equal(upgradeCustomerFieldBaselines(value),value);
});

test('baseline extension accepts remote-only edits and local-only edits without hiding real conflicts', () => {
  const workspace={_syncBase:{customers:{'client-1':oldBase()}}};upgradeCustomerFieldBaselines(workspace);
  const base=workspace._syncBase.customers['client-1'],local={...oldRow,...defaults};
  const remoteEdit={row:{...local,name:'Remote name',additional_contact:'Cloud buyer'},version:'remote-version'};
  assert.equal(syncDecision(local,remoteEdit,base),'remote');
  const localEdit={...local,preferred_supplier:'Device supplier'};
  assert.equal(syncDecision(localEdit,{row:local,version:base.version},base),'update');
  assert.equal(syncDecision(localEdit,remoteEdit,base),'conflict');
  assert.equal(syncDecision({...local,contact_name:'Offline primary correction'},remoteEdit,base),'conflict');
  const merged=mergeRecords([local],[{item:remoteEdit.row,version:remoteEdit.version}],workspace._syncBase.customers);
  assert.equal(merged.items[0].additional_contact,'Cloud buyer');
  assert.equal(merged.items[0].name,'Remote name');
  const conflicted=mergeRecords([localEdit],[{item:remoteEdit.row,version:remoteEdit.version}],workspace._syncBase.customers);
  assert.equal(conflicted.items[0].preferred_supplier,'Device supplier');
  assert.equal(conflicted.baselines['client-1'].version,'original-version');
});
