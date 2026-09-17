import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('offline installer deduplicates relative/absolute URLs and includes the supplier PDF', async()=>{
  const {runInNewContext}=await import('node:vm');
  const script=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  const listeners={};let urls=[];let installed=false;
  runInNewContext(script,{
    URL,
    self:{location:{href:'https://example.test/onconapp/sw.js',origin:'https://example.test'},addEventListener:(event,handler)=>{listeners[event]=handler;},skipWaiting:()=>{installed=true;}},
    caches:{open:async()=>({put:async()=>{},addAll:async list=>{urls=list;}})},
    fetch:async()=>({clone:()=>({text:async()=>'<link href="./icon.svg"><link href="manifest.json"><script src="./assets/app.js"></script>'})})
  });
  let install;
  listeners.install({waitUntil:promise=>{install=promise;}});
  await install;
  assert.equal(installed,true);
  assert.equal(new Set(urls).size,urls.length);
  assert.equal(urls.filter(url=>url.endsWith('/icon.svg')).length,1);
  assert.ok(urls.includes('https://example.test/onconapp/niewbev-on-con-2026-08-01.pdf'));
});
import { loadPriceListPdf, canSharePdf, sharePriceListPdf, PRICE_LIST_PDF_NAME } from '../price-list-pdf.js';

test('supplier PDF is unchanged and loads as a named PDF attachment', async()=>{
  const bytes=await readFile(new URL('../public/niewbev-on-con-2026-08-01.pdf',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'10d8a038c747bcc906a9b6c65c6552af7d66c2becaa02e320a5291de47d81f69');
  const file=await loadPriceListPdf(async()=>new Response(bytes));
  assert.equal(file.name,PRICE_LIST_PDF_NAME);
  assert.equal(file.type,'application/pdf');
  assert.equal(file.size,443064);
  assert.equal(await file.slice(0,5).text(),'%PDF-');
});
test('invalid downloads and network failures are rejected, not shared as PDFs', async()=>{
  await assert.rejects(loadPriceListPdf(async()=>new Response('error',{status:404})));
  await assert.rejects(loadPriceListPdf(async()=>new Response('<html>fallback</html>')));
  await assert.rejects(loadPriceListPdf(async()=>{throw new Error('offline');}));
});
test('share hands off the file synchronously during the tap and never claims delivery', async()=>{
  const file=new File(['%PDF-'],PRICE_LIST_PDF_NAME,{type:'application/pdf'});
  let called=false;
  const pending=sharePriceListPdf(file,{canShare:({files})=>files[0]===file,share:async payload=>{
    called=true;assert.equal(payload.files[0],file);assert.equal(payload.url,undefined);
  }});
  assert.equal(called,true);
  assert.equal(await pending,'shared');
});
test('unsupported, cancelled and denied sharing have distinct safe outcomes',async()=>{
  const file=new File(['%PDF-'],PRICE_LIST_PDF_NAME,{type:'application/pdf'});
  assert.equal(canSharePdf(null,{}),false);
  assert.equal(canSharePdf(file,{canShare:()=>{throw new Error();},share(){}}),false);
  assert.equal(await sharePriceListPdf(file,{}),'unsupported');
  assert.equal(await sharePriceListPdf(file,{canShare:()=>true,share:async()=>{throw new DOMException('cancel','AbortError');}}),'cancelled');
  assert.equal(await sharePriceListPdf(file,{canShare:()=>true,share:async()=>{throw new DOMException('denied','NotAllowedError');}}),'failed');
});
