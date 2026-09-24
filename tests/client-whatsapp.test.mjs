import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWhatsAppPhone,clientWhatsAppTarget} from '../client-whatsapp.js';

test('South African phone formats open the same exact international WhatsApp number',()=>{
 for(const value of ['082 123 4567','(082) 123-4567','+27 82 123 4567','0027 82 123 4567','27821234567','+27 (0)82 123 4567','0027 (0) 82 123 4567'])assert.equal(normalizeWhatsAppPhone(value),'27821234567',value);
 assert.equal(normalizeWhatsAppPhone('012 345 6789'),'27123456789');
});

test('explicit international numbers retain their country code and internal zeroes',()=>{
 assert.equal(normalizeWhatsAppPhone('+44 20 7123 4567'),'442071234567');
 assert.equal(normalizeWhatsAppPhone('001 (202) 555-0123'),'12025550123');
 assert.equal(normalizeWhatsAppPhone('+39 06 1234 5678'),'390612345678');
});

test('ambiguous, multiple, malformed and injectable numbers never produce a chat link',()=>{
 for(const value of ['',null,821234567,'821234567','12025550123','0821234567 / 0831234567','0821234567 ext 2','0821234567,2','082123\n4567','javascript:alert(1)','+27821234567?text=PRIVATE','++27821234567','+270821234567','+278212345678','+01234567890','+1234567890123456','+44 (0)20 7123 4567'])assert.equal(clientWhatsAppTarget({phone:value}).href,null,String(value));
});

test('only the chosen client phone is used, without mutation or private message contents',()=>{
 const client={id:'a',name:'Alpha Bistro',phone:'0821234567',email:'a@example.invalid',notes:'PRIVATE',profile:{phone:'0837654321'}};
 const original=JSON.stringify(client),target=clientWhatsAppTarget(client);
 assert.equal(target.href,'https://wa.me/27821234567');assert.equal(target.number,'27821234567');assert.equal(target.error,'');assert.equal(JSON.stringify(client),original);
 assert.equal(clientWhatsAppTarget({id:'b',phone:'0837654321'}).href,'https://wa.me/27837654321');
 assert.doesNotMatch(target.href,/PRIVATE|text|example/);
});

test('missing client or phone offers an actionable error rather than another recipient',()=>{
 assert.match(clientWhatsAppTarget(null).error,/Choose a client/);
 assert.match(clientWhatsAppTarget({phone:''}).error,/Edit details/);
 assert.match(clientWhatsAppTarget({phone:'0821234567,0837654321'}).error,/one full number/);
});
