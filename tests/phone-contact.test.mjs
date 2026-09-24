import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPhoneContact} from '../phone-contact.js';
const unfold = text => text.replace(/\r\n /g, '');

test('contact export includes the venue, person, role, phone and email, without CRM notes',()=>{
 const client={id:'client-1',name:'Alpha Bistro',contact:'Alex Smith',role:'Buyer',phone:'+27 82 123 4567',email:'alex@example.invalid',notes:'PRIVATE',opportunity:'PRIVATE',value:12345};
 const original=JSON.stringify(client),file=buildPhoneContact(client);
 assert.equal(file.filename,'fieldflow-Alpha-Bistro.vcf');assert.equal(file.type,'text/vcard;charset=utf-8');
 for(const line of ['BEGIN:VCARD','VERSION:3.0','FN:Alex Smith (Alpha Bistro)','N:;Alex Smith;;;','ORG:Alpha Bistro','TITLE:Buyer','TEL;TYPE=WORK,VOICE:+27 82 123 4567','EMAIL;TYPE=INTERNET,WORK:alex@example.invalid','END:VCARD'])assert.ok(file.content.split('\r\n').includes(line),line);
 assert.doesNotMatch(file.content,/PRIVATE|12345|client-1/);assert.equal(JSON.stringify(client),original);
});

test('contact export keeps Unicode and folds long UTF-8 lines without splitting characters',()=>{
 const person='Zoë '+ 'é🍷'.repeat(50),file=buildPhoneContact({name:'Café du Vin',contact:person});
 assert.ok(unfold(file.content).includes(`FN:${person} (Café du Vin)`));
 for(const line of file.content.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
 assert.doesNotMatch(file.content,/�/);
});

test('contact export escapes separators, strips controls and creates a safe filename',()=>{
 const file=buildPhoneContact({name:'../A;B,C\\D',contact:'Buyer\r\nEND:VCARD\r\nBEGIN:VCARD',email:'test@example.invalid\u0000'});
 assert.equal(file.filename,'fieldflow-ABCD.vcf');
 assert.equal(file.content.split('\r\n').filter(line=>line==='END:VCARD').length,1);
 assert.ok(file.content.includes('ORG:../A\\;B\\,C\\\\D'));
 assert.doesNotMatch(file.content,/\u0000/);
});

test('a venue-only contact omits missing phone and email and empty names are rejected',()=>{
 const file=buildPhoneContact({name:'New Venue'});
 assert.match(file.content,/FN:New Venue\r\n/);assert.doesNotMatch(file.content,/TEL|EMAIL|undefined|null/);
 assert.throws(()=>buildPhoneContact({}),/name/);
});
