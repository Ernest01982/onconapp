import { VISIT_WINE_OUTCOMES } from './domain.js';

// Selection is temporary UI state. It never changes a visit until Add / Apply.
export function toggleProductSelection(selection, wineId, selected) {
  const next = new Set(selection || []);
  if (typeof wineId !== 'string' || !wineId.trim()) return next;
  const shouldSelect = selected ?? !next.has(wineId);
  if (shouldSelect) next.add(wineId);
  else next.delete(wineId);
  return next;
}

const searchText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filterVisitProducts(products, query = '') {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return (products || []).filter(product => product?.id && product.active && terms.every(term =>
    searchText([product.name, product.brand, product.producer, product.variety, product.vintage, product.range, product.sku].filter(Boolean).join(' ')).includes(term)
  ));
}

function requestedIds(ids) {
  if (!Array.isArray(ids) && !(ids instanceof Set)) throw new Error('Choose products from the master list.');
  const result = [...new Set(ids)];
  if (result.some(id => typeof id !== 'string' || !id.trim())) throw new Error('Choose products from the master list.');
  return result;
}

// Reopening the picker must not reset individual outcomes, samples or notes.
// Existing rows (including historical/retired catalogue links) are preserved.
export function addVisitProducts(existing = [], selectedIds = [], catalogue = []) {
  const ids = requestedIds(selectedIds);
  const existingIds = new Set(existing.map(item => item.wineId));
  const availableIds = new Set(catalogue.filter(product => product?.active).map(product => product.id));
  const additions = ids.filter(id => !existingIds.has(id));
  if (additions.some(id => !availableIds.has(id))) throw new Error('A selected product is no longer available in the master list. Review your selection.');
  return [
    ...existing.map(item => ({ ...item })),
    ...additions.map(wineId => ({ wineId, outcome:'Discussed', sampleLeft:false }))
  ];
}

// A name in a note cannot distinguish pack sizes or SKUs. Explicitly selected
// IDs always win, and ambiguous names must be resolved in the product picker.
export function resolveDetectedVisitProducts(existing = [], names = [], catalogue = []) {
  const nameKey = value => searchText(value).trim().replace(/\s+/g, ' ');
  const selectedIds = new Set(existing.map(item => item.wineId));
  const selectedNames = new Set(catalogue.filter(product => selectedIds.has(product.id)).map(product => nameKey(product.name)));
  const additions = new Set();
  for (const name of names) {
    const key = nameKey(name);
    if (!key || selectedNames.has(key)) continue;
    const matches = new Set(catalogue.filter(product => product.active && nameKey(product.name) === key).map(product => product.id));
    if (matches.size !== 1) continue;
    additions.add([...matches][0]);
  }
  return addVisitProducts(existing, additions, catalogue);
}

// Only explicitly supplied fields change. In particular, tasting a wine and
// leaving a sample bottle are separate facts; neither implies the other.
export function applyVisitProductBatch(existing = [], selectedIds = [], change = {}) {
  const ids = requestedIds(selectedIds);
  if (!ids.length) throw new Error('Select at least one product first.');
  const selected = new Set(ids);
  const existingIds = new Set(existing.map(item => item.wineId));
  if (ids.some(id => !existingIds.has(id))) throw new Error('Add the selected products to this visit before applying an outcome.');
  const hasOutcome = Object.hasOwn(change, 'outcome');
  const hasSample = Object.hasOwn(change, 'sampleLeft');
  if (!hasOutcome && !hasSample) throw new Error('Choose an outcome or a sample-left action.');
  if (hasOutcome && !VISIT_WINE_OUTCOMES.includes(change.outcome)) throw new Error('Choose a valid visit outcome.');
  if (hasSample && typeof change.sampleLeft !== 'boolean') throw new Error('Choose whether samples were left.');
  return existing.map(item => selected.has(item.wineId) ? {
    ...item,
    ...(hasOutcome ? { outcome:change.outcome } : {}),
    ...(hasSample ? { sampleLeft:change.sampleLeft } : {})
  } : { ...item });
}
