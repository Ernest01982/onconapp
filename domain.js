export const WINE_STATUSES = [
  'Discussed',
  'Interested',
  'Sampled',
  'Considering',
  'Listed',
  'Delisted',
  'Not Interested'
];

export const VISIT_WINE_OUTCOMES = [...WINE_STATUSES.filter(status => status !== 'Delisted'), 'Follow-up required'];
export const PIPELINE_STATUSES = ['Interested', 'Sampled', 'Considering'];

const clone = value => JSON.parse(JSON.stringify(value));
const asNumberOrNull = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const isoNow = () => new Date().toISOString();

export function normalizeWorkspace(workspace, products = []) {
  const normalized = clone(workspace || {});
  normalized.customerWines = Array.isArray(normalized.customerWines) ? normalized.customerWines : [];
  normalized.visits = Array.isArray(normalized.visits) ? normalized.visits : [];
  normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
  normalized.travel = normalized.travel && typeof normalized.travel === 'object' ? normalized.travel : {};
  normalized.travel.trips = Array.isArray(normalized.travel.trips) ? normalized.travel.trips : [];
  normalized.travel.ratePerKm = Number(normalized.travel.ratePerKm) || 4.9;

  const productByName = new Map(products.map(item => [String(item.name || '').toLowerCase(), item.id]));
  normalized.visits = normalized.visits.map(visit => ({
    ...visit,
    products: Array.isArray(visit.products) ? visit.products : [],
    wineOutcomes: Array.isArray(visit.wineOutcomes)
      ? visit.wineOutcomes.filter(item => item?.wineId)
      : (visit.products || []).map(name => ({ wineId: productByName.get(String(name).toLowerCase()), outcome:'Discussed' })).filter(item => item.wineId)
  }));

  normalized.tasks = normalized.tasks.map(task => ({ ...task, wineId:task.wineId || null, visitId:task.visitId || null, completedAt:task.completedAt || null }));
  normalized.travel.trips = normalized.travel.trips.map(trip => {
    const startOdometer = asNumberOrNull(trip.startOdometer);
    const endOdometer = asNumberOrNull(trip.endOdometer);
    const customerId = trip.customerId || trip.toCustomerId || trip.fromCustomerId || null;
    return {
      ...trip,
      customerId,
      purpose: trip.purpose || (customerId ? 'Customer visit' : 'Business travel'),
      startOdometer,
      endOdometer,
      notes: trip.notes || '',
      distanceSource: trip.distanceSource || (startOdometer != null && endOdometer != null ? 'odometer' : 'gps')
    };
  });

  if (normalized.activeVisit) {
    normalized.activeVisit.wineOutcomes = Array.isArray(normalized.activeVisit.wineOutcomes)
      ? normalized.activeVisit.wineOutcomes.filter(item => item?.wineId)
      : [];
  }

  const relationships = new Map();
  for (const raw of normalized.customerWines) {
    if (!raw?.customerId || !raw?.wineId) continue;
    const key = `${raw.customerId}\u0000${raw.wineId}`;
    const relation = {
      id: raw.id || createRelationshipId(),
      customerId: raw.customerId,
      wineId: raw.wineId,
      status: WINE_STATUSES.includes(raw.status) ? raw.status : 'Discussed',
      interestStartedAt: raw.interestStartedAt || null,
      sampledAt: raw.sampledAt || null,
      listingDate: raw.listingDate || null,
      delistingDate: raw.delistingDate || null,
      allocation: raw.allocation || '',
      notes: raw.notes || '',
      followUpAt: raw.followUpAt || null,
      history: Array.isArray(raw.history) ? raw.history.slice(-200) : [],
      createdAt: raw.createdAt || raw.updatedAt || isoNow(),
      updatedAt: raw.updatedAt || raw.createdAt || isoNow()
    };
    const previous = relationships.get(key);
    if (!previous || new Date(relation.updatedAt) >= new Date(previous.updatedAt)) relationships.set(key, relation);
  }
  normalized.customerWines = [...relationships.values()];
  return normalized;
}

export function createRelationshipId() {
  return `rw${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
}

export function findCustomerWine(workspace, customerId, wineId) {
  return (workspace.customerWines || []).find(item => item.customerId === customerId && item.wineId === wineId) || null;
}

export function upsertCustomerWine(workspace, change, at = isoNow()) {
  if (!change?.customerId || !change?.wineId) throw new Error('A customer and wine are required.');
  if (!WINE_STATUSES.includes(change.status)) throw new Error('Choose a valid wine status.');
  workspace.customerWines ||= [];
  let relation = findCustomerWine(workspace, change.customerId, change.wineId);
  const isNew = !relation;
  if (!relation) {
    relation = {
      id:createRelationshipId(), customerId:change.customerId, wineId:change.wineId,
      status:change.status, interestStartedAt:null, sampledAt:null, listingDate:null,
      delistingDate:null, allocation:'', notes:'', followUpAt:null, history:[],
      createdAt:at, updatedAt:at
    };
    workspace.customerWines.push(relation);
  }

  const statusChanged = isNew || relation.status !== change.status;
  if (statusChanged) {
    relation.history = [...(relation.history || []), {
      status:change.status,
      at,
      visitId:change.visitId || null,
      note:change.historyNote || ''
    }].slice(-200);
  }
  relation.status = change.status;
  if (PIPELINE_STATUSES.includes(change.status) && !relation.interestStartedAt) relation.interestStartedAt = change.interestStartedAt || at;
  if (change.status === 'Sampled' && !relation.sampledAt) relation.sampledAt = change.sampledAt || at;
  if (change.status === 'Listed' && (statusChanged || change.listingDate)) relation.listingDate = change.listingDate || at;
  if (change.status === 'Listed') relation.delistingDate = null;
  if (change.status === 'Delisted' && statusChanged) relation.delistingDate = change.delistingDate || at;
  if (change.status !== 'Delisted' && change.status !== 'Listed' && statusChanged) relation.delistingDate = null;
  if ('allocation' in change) relation.allocation = String(change.allocation || '').trim();
  if ('notes' in change) relation.notes = String(change.notes || '').trim();
  if ('followUpAt' in change) relation.followUpAt = change.followUpAt || null;
  relation.updatedAt = at;
  return relation;
}

export function applyVisitWineOutcomes(workspace, visit, defaultFollowUpAt) {
  const updated = [];
  const progress = { Discussed:0, Interested:1, Sampled:2, Considering:3, Listed:4 };
  for (const item of visit.wineOutcomes || []) {
    if (!item?.wineId) continue;
    const existing = findCustomerWine(workspace, visit.customerId, item.wineId);
    let status = item.outcome === 'Follow-up required' ? (existing?.status || 'Discussed') : item.outcome;
    if (existing && status in progress && existing.status in progress && progress[status] < progress[existing.status]) status = existing.status;
    if (existing?.status === 'Listed' && status === 'Not Interested') status = 'Listed';
    if (!WINE_STATUSES.includes(status)) continue;
    updated.push(upsertCustomerWine(workspace, {
      customerId:visit.customerId,
      wineId:item.wineId,
      status,
      visitId:visit.id,
      followUpAt:item.outcome === 'Follow-up required' ? (item.followUpAt || defaultFollowUpAt || null) : (existing?.followUpAt || null),
      historyNote:`Visit outcome: ${item.outcome}`
    }, visit.end || isoNow()));
  }
  return updated;
}

export function taskBuckets(tasks, reference = new Date()) {
  const dayStart = new Date(reference); dayStart.setHours(0,0,0,0);
  const tomorrow = new Date(dayStart); tomorrow.setDate(tomorrow.getDate() + 1);
  const buckets = { overdue:[], today:[], upcoming:[], completed:[] };
  for (const task of [...tasks].sort((a,b) => new Date(a.due) - new Date(b.due))) {
    if (task.done) buckets.completed.push(task);
    else if (new Date(task.due) < dayStart) buckets.overdue.push(task);
    else if (new Date(task.due) < tomorrow) buckets.today.push(task);
    else buckets.upcoming.push(task);
  }
  return buckets;
}

export function calculateTripDistance({ startOdometer, endOdometer, manualDistance, gpsDistance = 0 }) {
  const start = asNumberOrNull(startOdometer);
  const end = asNumberOrNull(endOdometer);
  if ((start == null) !== (end == null)) throw new Error('Enter both start and end odometer readings, or leave both blank.');
  if (start != null && end < start) throw new Error('End odometer cannot be lower than start odometer.');
  if (start != null) return { distanceKm:Number((end - start).toFixed(3)), distanceSource:'odometer', startOdometer:start, endOdometer:end };
  const manual = asNumberOrNull(manualDistance);
  const distance = manual ?? Number(gpsDistance || 0);
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Kilometres must be zero or more.');
  return { distanceKm:Number(distance.toFixed(3)), distanceSource:manual != null ? 'manual' : 'gps', startOdometer:null, endOdometer:null };
}

function localDay(value) {
  const date = new Date(value);
  date.setHours(0,0,0,0);
  return date;
}

export function dateRange(period = 'week', customStart = '', customEnd = '', reference = new Date()) {
  const start = localDay(reference);
  let end = new Date(start);
  if (period === 'today') end.setDate(end.getDate() + 1);
  else if (period === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end = new Date(start); end.setDate(end.getDate() + 7);
  } else if (period === 'month') {
    start.setDate(1);
    end = new Date(start); end.setMonth(end.getMonth() + 1);
  } else {
    const parsedStart = customStart ? new Date(`${customStart}T00:00:00`) : start;
    const parsedEnd = customEnd ? new Date(`${customEnd}T00:00:00`) : parsedStart;
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime()) || parsedEnd < parsedStart) throw new Error('Choose a valid custom date range.');
    end = new Date(parsedEnd); end.setDate(end.getDate() + 1);
    return { start:parsedStart, end, label:`${customStart || 'Start'} to ${customEnd || customStart || 'End'}` };
  }
  const label = period === 'today' ? 'Today' : period === 'week' ? 'This week' : 'This month';
  return { start, end, label };
}

export const isInRange = (value, range) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= range.start && date < range.end;
};

export function groupKm(trips, keyFn) {
  const totals = new Map();
  for (const trip of trips) {
    const key = keyFn(trip) || 'Unassigned';
    totals.set(key, (totals.get(key) || 0) + Number(trip.distanceKm || 0));
  }
  return [...totals.entries()].map(([label, km]) => ({ label, km:Number(km.toFixed(3)) })).sort((a,b) => b.km - a.km);
}
