// One native picker for reviewed messages and real attachments. A successful
// hand-off is not evidence of sending, delivery, or the selected app/account.
// Load attachments before the tap; this helper must not await before share().
function preparedContent(content) {
  if (!content || typeof content !== 'object') return null;
  const payload = {};
  if (typeof content.title === 'string' && content.title.trim()) payload.title = content.title;
  if (typeof content.text === 'string' && content.text.trim()) payload.text = content.text;
  if (content.files !== undefined) {
    if (!Array.isArray(content.files)) return null;
    if (content.files.some(file => typeof File === 'undefined' || !(file instanceof File) || file.size === 0)) return null;
    if (content.files.length) payload.files = [...content.files];
  }
  // Do not accept URL-only sharing as a substitute for the actual attachment.
  // Unknown fields (recipient, sender, private notes, etc.) never leave here.
  return payload.text || payload.files?.length ? payload : null;
}

function supported(payload, device) {
  if (!payload || typeof device?.share !== 'function') return false;
  try {
    // A browser may ignore unknown dictionary fields. Check files alone first
    // so a text-capable browser cannot silently drop the PDF from this share.
    if (payload.files && (typeof device.canShare !== 'function' || !device.canShare({ files:payload.files }))) return false;
    return typeof device.canShare !== 'function' || device.canShare(payload) === true;
  } catch {
    return false;
  }
}

export function canShareContent(content, device = globalThis.navigator) {
  return supported(preparedContent(content), device);
}

export async function shareContent(content, device = globalThis.navigator) {
  const payload = preparedContent(content);
  if (!payload) return 'invalid';
  if (!supported(payload, device)) return 'unsupported';
  try {
    await device.share(payload);
    return 'shared';
  } catch (error) {
    // AbortError can also mean no target was available; do not call this sent.
    if (error?.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

export function shareOutcomeMessage(result, { attachment = false } = {}) {
  if (result === 'shared') return attachment
    ? 'PDF handed to your chosen app. Check the attachment, recipient and sender account before sending.'
    : 'Message handed to your chosen app. Check the recipient and sender account before sending.';
  if (result === 'cancelled') return 'Sharing closed. Nothing has been marked as sent.';
  if (result === 'invalid') return attachment
    ? 'The PDF is not ready. Retry loading it, or download it and attach it yourself.'
    : 'Write a message before sharing.';
  return attachment
    ? 'File sharing is unavailable. Download the PDF and attach it in your chosen app.'
    : 'Sharing is unavailable. Copy the message into your chosen app.';
}
