// Fingerprints are canonical row snapshots, not security hashes.
export function roundDecimal(value, places = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Enter a finite number.');
  const shift = (v, p) => { const [m,e='0'] = String(v).split('e'); return Number(`${m}e${Number(e)+p}`); };
  return shift(Math.sign(n) * Math.round(shift(Math.abs(n), places)), -places);
}

export function canonicalTripRow(row) {
  const result = {...row};
  for (const [key,places] of Object.entries({distance_km:3,rate_per_km:2,reimbursement:2,start_odometer:1,end_odometer:1})) {
    if (result[key] != null && Number.isFinite(Number(result[key]))) result[key] = roundDecimal(result[key],places);
  }
  return result;
}

// Migrate only historical fingerprints, never manufacture a baseline from
// today's device/cloud rows. Keep versions and unknown/corrupt data intact.
export function upgradeReliabilityBaselines(workspace) {
  for (const key of ['_syncBase','_syncPendingBase']) for (const table of ['visits','travel_trips']) {
    for (const [id,base] of Object.entries(workspace?.[key]?.[table] || {})) {
      try {
        let row=JSON.parse(base.fingerprint);
        if (!row || row.id!==id || typeof row.user_id!=='string' || !row.user_id || fingerprint(row)!==base.fingerprint) continue;
        const defaults=table==='visits'?{time_corrections:[],location_capture:{}}:{recording_flags:[],daily_log:{}};
        for(const [field,value] of Object.entries(defaults)) if(!Object.hasOwn(row,field)) row[field]=value;
        if(table==='travel_trips')row=canonicalTripRow(row);
        base.fingerprint=fingerprint(row);
      } catch { /* Leave unidentified baselines for explicit recovery. */ }
    }
  }
  return workspace;
}

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
