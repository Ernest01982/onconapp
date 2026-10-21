import test from 'node:test';
import assert from 'node:assert/strict';
import { canShareContent, shareContent, shareOutcomeMessage } from '../native-share.js';

const pdf = () => new File(['%PDF-1.7 example'], 'Niew Beverages price list.pdf', { type:'application/pdf' });

test('native PDF sharing passes the actual File and reviewed message synchronously', async () => {
  const file = pdf();
  let called = false;
  const content = { title:'Price list', text:'Hi Willow, here is the price list.', files:[file], to:'client@example.test', from:'rep@example.test', privateNotes:'never share' };
  const pending = shareContent(content, {
    canShare:({files}) => !files || files[0] === file,
    share:async payload => {
      called = true;
      assert.deepEqual(Object.keys(payload).sort(), ['files','text','title']);
      assert.equal(payload.files[0], file);
      assert.equal(payload.text, content.text);
      assert.equal(payload.url, undefined);
      assert.equal(payload.to, undefined);
      assert.equal(payload.from, undefined);
      assert.equal(payload.privateNotes, undefined);
    }
  });
  assert.equal(called, true, 'must call share during the original tap, before yielding');
  assert.equal(await pending, 'shared');
  assert.deepEqual(content.files, [file], 'caller draft is unchanged');
});

test('text-only sharing supports a device without file sharing and retains reviewed subject', async () => {
  let received;
  assert.equal(await shareContent({ title:'Follow-up', text:'Reviewed message' }, {share:async payload => { received = payload; }}), 'shared');
  assert.deepEqual(received, { title:'Follow-up', text:'Reviewed message' });
  assert.equal(canShareContent({ text:'Hi' }, undefined), false);
});

test('cannot fall back to text or URL when the PDF cannot be shared', async () => {
  const file = pdf();
  let shares = 0;
  const device = { canShare:payload => Boolean(payload.text), share:async () => {shares++;} };
  assert.equal(canShareContent({ text:'Message', files:[file] }, device), false);
  assert.equal(await shareContent({ text:'Message', files:[file] }, device), 'unsupported');
  assert.equal(await shareContent({ files:[file] }, { share:async () => {shares++;} }), 'unsupported');
  assert.equal(await shareContent({ url:'https://example.test/price-list.pdf' }, device), 'invalid');
  assert.equal(shares, 0);
});

test('invalid or empty attachments are rejected rather than silently dropped', async () => {
  let shares = 0;
  const device = {canShare:()=>true, share:async()=>{shares++;}};
  for (const files of [null, 'file.pdf', [{}], [new Blob(['PDF'],{type:'application/pdf'})], [new File([],'empty.pdf')]]) {
    assert.equal(await shareContent({text:'Reviewed message',files}, device), 'invalid');
  }
  assert.equal(await shareContent({title:'Title only',text:' '}, device), 'invalid');
  assert.equal(shares, 0);
});

test('cancel, denied and unsupported sharing do not retry or mutate task completion', async () => {
  const task = {id:'task1',done:false};
  let shares = 0;
  const cancelled = await shareContent({text:'Hi'}, {share:async()=>{shares++;throw new DOMException('cancelled','AbortError');}});
  const denied = await shareContent({text:'Hi'}, {share:async()=>{shares++;throw new DOMException('denied','NotAllowedError');}});
  const unsupported = await shareContent({files:[pdf()]}, {share:async()=>{shares++;},canShare:()=>{throw new Error('unsupported');}});
  assert.equal(cancelled,'cancelled');
  assert.equal(denied,'failed');
  assert.equal(unsupported,'unsupported');
  assert.equal(shares,2);
  assert.deepEqual(task,{id:'task1',done:false});
});

test('status copy never claims delivery and keeps manual attachment fallback explicit', () => {
  assert.match(shareOutcomeMessage('shared',{attachment:true}),/handed.*Check the attachment, recipient and sender account/);
  assert.match(shareOutcomeMessage('shared'),/handed.*sender account/);
  assert.match(shareOutcomeMessage('cancelled'),/Nothing has been marked as sent/);
  assert.match(shareOutcomeMessage('failed',{attachment:true}),/Download the PDF and attach it/);
  assert.match(shareOutcomeMessage('invalid',{attachment:true}),/not ready/);
  assert.match(shareOutcomeMessage('unsupported'),/Copy the message/);
});
