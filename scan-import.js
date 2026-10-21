// Convert a phone scanner's PDF into the same private JPEG page gallery as
// camera photos. Nothing is persisted here; callers save the complete result.
export const SCAN_PAGE_LIMIT = 30;
export const SCAN_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const SCAN_SELECTION_MAX_BYTES = 90 * 1024 * 1024;
export const SCAN_MAX_EDGE = 2400;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
let rendererPromise;

export function scanFileKind(file) {
  if (file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')) return 'pdf';
  if (IMAGE_TYPES.has(file?.type)) return 'image';
  throw new Error('Choose JPEG, PNG or WebP photos, or a PDF exported from your phone scanner.');
}

export function validateScanPageCount(count, remainingPages) {
  if (!Number.isInteger(remainingPages) || remainingPages < 0 || remainingPages > SCAN_PAGE_LIMIT) throw new Error('Could not determine the available wine-list page slots. Reopen this gallery.');
  if (!Number.isInteger(count) || count < 0) throw new Error('The scan has an invalid page count.');
  if (count > remainingPages) throw new Error(`This selection contains ${count} pages, but only ${remainingPages} of the 30 page slots are available. No pages were added.`);
  return count;
}

export function validateScanSelection(files, remainingPages) {
  const selected = Array.from(files || []);
  validateScanPageCount(selected.length, remainingPages);
  let total = 0;
  for (const file of selected) {
    scanFileKind(file);
    if (!(file instanceof Blob) || !Number.isFinite(file.size) || file.size < 1) throw new Error('An empty or unreadable file was selected. No pages were added.');
    if (file.size > SCAN_FILE_MAX_BYTES) throw new Error('Each photo or scan PDF must be 25 MB or smaller. Export a smaller scan and retry.');
    total += file.size;
  }
  if (total > SCAN_SELECTION_MAX_BYTES) throw new Error('Select no more than 90 MB at once. Import a smaller batch.');
  return selected;
}

export function scanPageDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('The PDF contains an invalid page size.');
  const scale = SCAN_MAX_EDGE / Math.max(width, height);
  return { scale, width:Math.max(1, Math.min(SCAN_MAX_EDGE, Math.round(width * scale))), height:Math.max(1, Math.min(SCAN_MAX_EDGE, Math.round(height * scale))) };
}

async function getRenderer() {
  rendererPromise ||= Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    import('pdfjs-dist/wasm/jbig2.wasm?url'),
    import('pdfjs-dist/wasm/openjpeg.wasm?url'),
    import('pdfjs-dist/wasm/qcms_bg.wasm?url')
  ]).then(([pdfjs, worker, jbig2, openjpeg, qcms]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const trustedAssets = new Map([['jbig2.wasm',jbig2.default], ['openjpeg.wasm',openjpeg.default], ['qcms_bg.wasm',qcms.default]]);
    class LocalDecoderData {
      async fetch({kind, filename}) {
        const url = kind === 'wasmUrl' && trustedAssets.get(filename);
        if (!url) throw new Error('This scan needs a decoder or font that is not supported. Export the scan as JPEG images instead.');
        const response = await fetch(url);
        if (!response.ok) throw new Error('The scan decoder is unavailable. Reconnect to the internet and reopen FieldFlow.');
        return new Uint8Array(await response.arrayBuffer());
      }
    }
    return {pdfjs, LocalDecoderData};
  }).catch(error => { rendererPromise = null; throw error; });
  return rendererPromise;
}

async function withPdf(file, callback) {
  if (!(await file.slice(0,1024).text()).includes('%PDF-')) throw new Error('The selected PDF is not a readable PDF document. No pages were added.');
  const {pdfjs, LocalDecoderData} = await getRenderer();
  const loading = pdfjs.getDocument({
    data:new Uint8Array(await file.arrayBuffer()),
    isEvalSupported:false,
    enableXfa:false,
    stopAtErrors:true,
    useWorkerFetch:false,
    BinaryDataFactory:LocalDecoderData,
    useSystemFonts:true,
    disableWorkerRendering:true,
    canvasMaxAreaInBytes:64 * 1024 * 1024
  });
  // No viewer, annotation layer, link service, action handlers or scripting
  // sandbox is instantiated. Password-protected files reject without a prompt.
  try {
    const document = await loading.promise;
    return await callback(document, pdfjs);
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('This PDF is password protected. Export an unlocked copy from your scanner and retry.');
    throw error;
  } finally {
    await loading.destroy();
  }
}

async function pageImage(document, pdfjs, pageNumber, filename) {
  const page = await document.getPage(pageNumber);
  let canvas;
  try {
    const original = page.getViewport({scale:1});
    const dimensions = scanPageDimensions(original.width, original.height);
    const viewport = page.getViewport({scale:dimensions.scale});
    canvas = globalThis.document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', {alpha:false});
    if (!context) throw new Error('Your browser could not prepare this scan. Try importing fewer pages.');
    await page.render({canvasContext:context, viewport, background:'rgb(255,255,255)', annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;
    const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The scan page could not be converted to a photo.')), 'image/jpeg', 0.9));
    if (blob.type !== 'image/jpeg') throw new Error('This browser cannot convert PDF pages to JPEG. Export the scan as JPEG images instead.');
    const stem = filename.replace(/\.pdf$/i,'').replace(/[\x00-\x1f\x7f/\\]/g,'-').slice(0,130) || 'Wine list scan';
    return new File([blob], `${stem} - page ${String(pageNumber).padStart(2,'0')}.jpg`, {type:'image/jpeg'});
  } finally {
    page.cleanup();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function expandScanFiles(files, remainingPages) {
  const selected = validateScanSelection(files, remainingPages);
  if (!selected.length) return [];
  const pageCounts = [];
  let total = 0;
  // Count and close each document first to bound memory and reject oversized
  // combined selections before producing or persisting any page images.
  for (const file of selected) {
    const count = scanFileKind(file) === 'pdf' ? await withPdf(file, document => document.numPages) : 1;
    if (!Number.isInteger(count) || count < 1) throw new Error('The scan contains no readable pages.');
    total += count;
    validateScanPageCount(total, remainingPages);
    pageCounts.push(count);
  }
  const result = [];
  for (let index = 0; index < selected.length; index++) {
    const file = selected[index];
    if (scanFileKind(file) === 'image') { result.push(file); continue; }
    await withPdf(file, async (document, pdfjs) => {
      if (document.numPages !== pageCounts[index]) throw new Error('The scan page count changed. Select the original file and retry.');
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) result.push(await pageImage(document, pdfjs, pageNumber, file.name));
    });
  }
  return result;
}
