import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFileKind,validateScanPageCount,validateScanSelection,scanPageDimensions,expandScanFiles,SCAN_FILE_MAX_BYTES} from '../scan-import.js';

test('scan picker accepts supported images and scanner PDFs, not active formats',()=>{
  assert.equal(scanFileKind({name:'Scan.PDF',type:''}),'pdf');
  assert.equal(scanFileKind({name:'scan',type:'application/pdf'}),'pdf');
  for (const type of ['image/jpeg','image/png','image/webp']) assert.equal(scanFileKind({type}),'image');
  for (const type of ['image/svg+xml','text/html','application/javascript','image/heic','']) assert.throws(()=>scanFileKind({type,name:'unknown'}));
});

test('combined PDF pages and existing gallery slots cannot exceed 30',()=>{
  assert.equal(validateScanPageCount(30,30),30);
  assert.equal(validateScanPageCount(2,2),2);
  assert.throws(()=>validateScanPageCount(3,2),/3 pages.*only 2/);
  assert.throws(()=>validateScanPageCount(31,30),/30 page slots/);
  assert.throws(()=>validateScanPageCount(1,31),/available/);
  assert.throws(()=>validateScanPageCount(-1,30),/invalid page count/);
  assert.throws(()=>validateScanPageCount(1.5,30),/invalid page count/);
});

test('oversized or empty scans reject before loading PDF.js',()=>{
  const empty=new File([],'empty.pdf',{type:'application/pdf'});
  assert.throws(()=>validateScanSelection([empty],30),/empty or unreadable/);
  const tooBig=new File([new Uint8Array(SCAN_FILE_MAX_BYTES+1)],'large.pdf',{type:'application/pdf'});
  assert.throws(()=>validateScanSelection([tooBig],30),/25 MB/);
  const twentyFive=new File([new Uint8Array(SCAN_FILE_MAX_BYTES)],'large.jpg',{type:'image/jpeg'});
  assert.throws(()=>validateScanSelection([twentyFive,twentyFive,twentyFive,twentyFive],30),/90 MB/);
});

test('image inputs pass through intact and malformed PDF signatures reject',async()=>{
  const image=new File(['image'],'page.jpg',{type:'image/jpeg'});
  const result=await expandScanFiles([image],1);
  assert.deepEqual(result,[image]);
  assert.equal(result[0],image);
  assert.deepEqual(await expandScanFiles([],0),[]);
  await assert.rejects(expandScanFiles([new File(['not PDF'],'fake.pdf',{type:'application/pdf'})],30),/not a readable PDF/);
});

test('render dimensions cap portrait, landscape and oversized pages at 2400 pixels',()=>{
  assert.deepEqual(scanPageDimensions(600,800),{scale:3,width:1800,height:2400});
  assert.deepEqual(scanPageDimensions(800,600),{scale:3,width:2400,height:1800});
  assert.deepEqual(scanPageDimensions(24000,24000),{scale:0.1,width:2400,height:2400});
  assert.throws(()=>scanPageDimensions(0,800),/invalid page size/);
  assert.throws(()=>scanPageDimensions(Infinity,800),/invalid page size/);
});
