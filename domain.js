import { mergeCatalogue } from './catalogue.js';

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
export const FEEDBACK_OUTCOMES = [
  'General relationship visit',
  'Positive — interested',
  'Sampled — follow-up needed',
  'Considering',
  'Listed / placement confirmed',
  'Order / trial agreed',
  'Not doing listings now / No current listing opportunity',
  'Not interested'
];
export const LISTING_REMINDER_DAYS = [30, 60, 90];

const clone = value => JSON.parse(JSON.stringify(value));
const asNumberOrNull = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const isoNow = () => new Date().toISOString();

export function normalizeWorkspace(workspace, products = []) {
  const normalized = clone(workspace || {});
  normalized.products = mergeCatalogue(normalized.products, products);
  normalized.customers = Array.isArray(normalized.customers) ? normalized.customers : [];
  normalized.customerWines = Array.isArray(normalized.customerWines) ? normalized.customerWines : [];
  normalized.visits = Array.isArray(normalized.visits) ? normalized.visits : [];
  normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
  normalized.travel = normalized.travel && typeof normalized.travel === 'object' ? normalized.travel : {};
  normalized.travel.trips = Array.isArray(normalized.travel.trips) ? normalized.travel.trips : [];
  normalized.travel.ratePerKm = Number(normalized.travel.ratePerKm) || 4.9;

  normalized.customers = normalized.customers.map(customer => ({
    ...customer,
    emailFollowUps: Array.isArray(customer.emailFollowUps) ? customer.emailFollowUps : [],
    menuChangeDate: customer.menuChangeDate || null,
    menuChangeMonth: /^\d{4}-\d{2}$/.test(customer.menuChangeMonth || '') ? customer.menuChangeMonth : '',
    listingsReopenAt: customer.listingsReopenAt || null,
    listingsReopenMonth: /^\d{4}-\d{2}$/.test(customer.listingsReopenMonth || '') ? customer.listingsReopenMonth : '',
    listingReminderDays: LISTING_REMINDER_DAYS.includes(Number(customer.listingReminderDays)) ? Number(customer.listingReminderDays) : 60,
    listingCycleNotes: customer.listingCycleNotes || ''
  }));

  const productByName = new Map(normalized.products.map(item => [String(item.name || '').toLowerCase(), item.id]));
  normalized.visits = normalized.visits.map(visit => ({
    ...visit,
    products: Array.isArray(visit.products) ? visit.products : [],
    contactSnapshot: visit.contactSnapshot && typeof visit.contactSnapshot === 'object' ? visit.contactSnapshot : {},
    feedbackOutcome: visit.feedbackOutcome || visit.outcome || 'Visit completed',
    currentWineIds: Array.isArray(visit.currentWineIds) ? visit.currentWineIds.filter(Boolean) : [],
    samplesLeftWineIds: Array.isArray(visit.samplesLeftWineIds) ? visit.samplesLeftWineIds.filter(Boolean) : [],
    followUpRequired: Boolean(visit.followUpRequired || visit.followUp),
    followUpReason: visit.followUpReason || visit.nextAction || '',
    followUpContact: visit.followUpContact || '',
    followUpTaskId: visit.followUpTaskId || null,
    followUpCompleted: Boolean(visit.followUpCompleted),
    menuChangeDate: visit.menuChangeDate || null,
    menuChangeMonth: /^\d{4}-\d{2}$/.test(visit.menuChangeMonth || '') ? visit.menuChangeMonth : '',
    listingsReopenAt: visit.listingsReopenAt || null,
    listingsReopenMonth: /^\d{4}-\d{2}$/.test(visit.listingsReopenMonth || '') ? visit.listingsReopenMonth : '',
    listingReminderDays: LISTING_REMINDER_DAYS.includes(Number(visit.listingReminderDays)) ? Number(visit.listingReminderDays) : 60,
    wineOutcomes: Array.isArray(visit.wineOutcomes)
      ? visit.wineOutcomes.filter(item => item?.wineId).map(item => ({ ...item, sampleLeft:Boolean(item.sampleLeft) }))
      : (visit.products || []).map(name => ({ wineId: productByName.get(String(name).toLowerCase()), outcome:'Discussed' })).filter(item => item.wineId)
  }));

  normalized.tasks = normalized.tasks.map(task => ({
    ...task,
    wineId:task.wineId || null,
    visitId:task.visitId || null,
    completedAt:task.completedAt || null,
    reminderType:task.reminderType || 'followup',
    reason:task.reason || task.title || '',
    contactPerson:task.contactPerson || '',
    rescheduleHistory:Array.isArray(task.rescheduleHistory) ? task.rescheduleHistory.slice(-50) : []
  }));
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
      ? normalized.activeVisit.wineOutcomes.filter(item => item?.wineId).map(item => ({ ...item, sampleLeft:Boolean(item.sampleLeft) }))
      : [];
    normalized.activeVisit.contactSnapshot = normalized.activeVisit.contactSnapshot && typeof normalized.activeVisit.contactSnapshot === 'object' ? normalized.activeVisit.contactSnapshot : {};
    normalized.activeVisit.feedbackOutcome ||= 'General relationship visit';
    normalized.activeVisit.currentWineIds = Array.isArray(normalized.activeVisit.currentWineIds) ? normalized.activeVisit.currentWineIds.filter(Boolean) : [];
    normalized.activeVisit.followUpRequired = Boolean(normalized.activeVisit.followUpRequired);
    normalized.activeVisit.followUpReason ||= '';
    normalized.activeVisit.followUpContact ||= '';
    normalized.activeVisit.nextAction ||= '';
    normalized.activeVisit.menuChangeDate ||= null;
    normalized.activeVisit.menuChangeMonth = /^\d{4}-\d{2}$/.test(normalized.activeVisit.menuChangeMonth || '') ? normalized.activeVisit.menuChangeMonth : '';
    normalized.activeVisit.listingsReopenAt ||= null;
    normalized.activeVisit.listingsReopenMonth = /^\d{4}-\d{2}$/.test(normalized.activeVisit.listingsReopenMonth || '') ? normalized.activeVisit.listingsReopenMonth : '';
    normalized.activeVisit.listingReminderDays = LISTING_REMINDER_DAYS.includes(Number(normalized.activeVisit.listingReminderDays)) ? Number(normalized.activeVisit.listingReminderDays) : 60;
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

export function listingCycleTarget(customer) {
  const value = customer?.listingsReopenAt || (customer?.listingsReopenMonth ? `${customer.listingsReopenMonth}-01T09:00:00` : '') || customer?.menuChangeDate || (customer?.menuChangeMonth ? `${customer.menuChangeMonth}-01T09:00:00` : '');
  if (!value) return null;
  const target = new Date(value);
  return Number.isNaN(target.getTime()) ? null : target;
}

export function listingCycleReminders(customers, reference = new Date()) {
  const today = localDay(reference);
  const reminders = [];
  for (const customer of customers || []) {
    const target = listingCycleTarget(customer);
    if (!target) continue;
    const targetDay = localDay(target);
    const leadDays = LISTING_REMINDER_DAYS.includes(Number(customer.listingReminderDays)) ? Number(customer.listingReminderDays) : 60;
    const remindAt = new Date(targetDay); remindAt.setDate(remindAt.getDate() - leadDays);
    const windowEnds = new Date(targetDay); windowEnds.setDate(windowEnds.getDate() + 31);
    if (today >= windowEnds) continue;
    const state = today >= targetDay ? 'open' : today >= remindAt ? 'due' : 'upcoming';
    reminders.push({ customerId:customer.id, targetAt:targetDay.toISOString(), remindAt:remindAt.toISOString(), leadDays, state });
  }
  return reminders.sort((a,b) => new Date(a.targetAt) - new Date(b.targetAt));
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
