// Fingerprints are canonical row snapshots, not security hashes.
export function fingerprint(value) {
  const canonical = item => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().filter(key => !['updated_at','created_at'].includes(key)).map(key => [key, canonical(item[key])]));
    if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(item) && Number.isFinite(Date.parse(item))) return new Date(item).toISOString();
    return item;
  };
  return JSON.stringify(canonical(value));
}

export function syncDecision(local, remote, baseline) {
  if (!local && !remote) return 'none';
  if (local && remote && fingerprint(local) === fingerprint(remote.row)) return 'ack';
  if (!baseline) return remote ? (local ? 'conflict' : 'remote') : 'insert';
  const unchanged = local && fingerprint(local) === baseline.fingerprint;
  if (unchanged) return 'remote';
  if (!remote || remote.version !== baseline.version) return 'conflict';
  return local ? 'update' : 'delete';
}

export function mergeRecords(local, remote, baselines = {}, toRow = item => item) {
  const locals = new Map(local.map(item => [item.id, item]));
  const remotes = new Map(remote.map(item => [item.item.id, item]));
  const merged = [], nextBase = {...baselines};
  for (const id of new Set([...locals.keys(), ...remotes.keys(), ...Object.keys(baselines)])) {
    const here = locals.get(id), there = remotes.get(id);
    const remoteRow = there && {row:toRow(there.item), version:there.version};
    const decision = syncDecision(here && toRow(here), remoteRow, baselines[id]);
    if (['remote','ack'].includes(decision)) {
      if(there) { merged.push(there.item); nextBase[id]={fingerprint:fingerprint(remoteRow.row),version:there.version}; }
      else delete nextBase[id];
    } else {
      if(here) merged.push(here);
      if(decision==='none')delete nextBase[id];
    }
  }
  return {items:merged, baselines:nextBase};
}
