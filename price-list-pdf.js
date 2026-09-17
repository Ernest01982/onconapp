export const PRICE_LIST_PDF_URL = './niewbev-on-con-2026-08-01.pdf';
export const PRICE_LIST_PDF_NAME = 'NiewBev - On Con Price list 01.08.2026.pdf';

export async function loadPriceListPdf(fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(PRICE_LIST_PDF_URL, { signal:controller.signal });
    if (!response.ok) throw new Error('The price-list PDF could not be downloaded.');
    const blob = await response.blob();
    if ((await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('The downloaded file is not a PDF.');
    return new File([blob], PRICE_LIST_PDF_NAME, { type:'application/pdf' });
  } finally {
    clearTimeout(timeout);
  }
}

export function canSharePdf(file, device = navigator) {
  try {
    return Boolean(file && device.share && device.canShare?.({ files:[file] }));
  } catch {
    return false;
  }
}

// Call directly from a tap, after loading the file, to preserve user activation.
// Resolution means hand-off only, never proof an email was sent.
export async function sharePriceListPdf(file, device = navigator) {
  if (!canSharePdf(file, device)) return 'unsupported';
  try {
    await device.share({ files:[file], title:'Niew Beverages On Con price list' });
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
