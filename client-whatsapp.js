const FORMAT_HELP = 'Use one full number: 082 123 4567 for South Africa, or +country code for other countries. No extensions or multiple numbers.';

export function normalizeWhatsAppPhone(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Add the client’s WhatsApp number in Edit details → Phone.');
  let raw = value.trim();
  if (/[\r\n]/.test(raw) || /[^\d+().\s-]/u.test(raw)) throw new Error(FORMAT_HELP);
  // South African local numbers are the only national format we infer.
  raw = raw.replace(/^(?:\+27|0027|27)\s*\(0\)/, '+27');
  if (/\(0\)/.test(raw)) throw new Error('Use the full international number without the optional (0) prefix.');
  const compact = raw.replace(/[\s().-]/g, '');
  let number;
  if (/^\+\d+$/.test(compact)) number = compact.slice(1);
  else if (/^00\d+$/.test(compact)) number = compact.slice(2);
  else if (/^0[1-9]\d{8}$/.test(compact)) number = '27' + compact.slice(1);
  else if (/^27[1-9]\d{8}$/.test(compact)) number = compact;
  else throw new Error(FORMAT_HELP);
  if (!/^[1-9]\d{7,14}$/.test(number) || (number.startsWith('27') && !/^27[1-9]\d{8}$/.test(number))) throw new Error(FORMAT_HELP);
  return number;
}

export function clientWhatsAppTarget(client) {
  if (!client) return {href:null, number:null, error:'Choose a client to open their WhatsApp chat.'};
  try {
    const number = normalizeWhatsAppPhone(client.phone);
    return {href:`https://wa.me/${number}`, number, error:''};
  } catch (error) {
    return {href:null, number:null, error:error.message};
  }
}
