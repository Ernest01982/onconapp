// A user-confirmed contact-file import; no access to the phone's address book.
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const escapeText = value => clean(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
const encoder = new TextEncoder();
function foldLine(line) {
  const lines = [];
  let part = '', bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { lines.push(part); part = ' '; bytes = 1; }
    part += character; bytes += size;
  }
  lines.push(part);
  return lines.join('\r\n');
}

export function buildPhoneContact(client) {
  const venue = clean(client?.name), person = clean(client?.contact);
  if (!venue && !person) throw new Error('Add a client or contact name first.');
  const display = person && venue ? `${person} (${venue})` : person || venue;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeText(display)}`, `N:;${escapeText(person || venue)};;;`];
  if (venue) lines.push(`ORG:${escapeText(venue)}`);
  if (clean(client?.role)) lines.push(`TITLE:${escapeText(client.role)}`);
  if (clean(client?.phone)) lines.push(`TEL;TYPE=WORK,VOICE:${escapeText(client.phone)}`);
  if (clean(client?.email)) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeText(client.email)}`);
  lines.push('END:VCARD');
  const stem = (venue || person).replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/g, '-').slice(0,80) || 'client';
  return {filename:`fieldflow-${stem}.vcf`, content:lines.map(foldLine).join('\r\n')+'\r\n', type:'text/vcard;charset=utf-8'};
}
