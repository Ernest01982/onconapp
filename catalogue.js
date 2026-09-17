// Refresh supplier fields without changing IDs referenced by historical activity.
export function mergeCatalogue(existing = [], catalogue = []) {
  const saved = Array.isArray(existing) ? existing : [];
  const used = new Set();
  const result = saved.map(product => {
    const current = catalogue.find(item => item.id === product.id)
      || catalogue.find(item => item.sku === product.sku)
      || (product.sku === 'NAM-5' ? catalogue.find(item => item.sku === 'NAMCB01') : null);
    if (!current) return { ...product };
    used.add(current.id);
    return { ...product, ...current, id:product.id };
  });
  for (const product of catalogue) {
    if (!used.has(product.id)) result.push({ ...product });
  }
  return result;
}
