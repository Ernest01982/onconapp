import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && publishableKey);
const client = configured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

let session = null;
let getLocalData = () => null;
let setLocalData = () => {};
let onIdentityChange = async () => {};
let onStatus = () => {};
let syncTimer = null;
let syncing = false;
let lastSynced = null;
let lastError = '';
let lastHashes = {};
let handledUserId = null;
let activeUserId;
let identityGeneration = 0;
let identityReady = false;
let sessionChangeChain = Promise.resolve();

class StaleIdentityError extends Error {}

function assertCurrentIdentity(userId, generation) {
  if (!identityReady || activeUserId !== userId || identityGeneration !== generation) throw new StaleIdentityError();
}

const hash = value => JSON.stringify(value);
const numberOrNull = value => value == null ? null : Number(value);

function status() {
  return {
    configured,
    signedIn: Boolean(session?.user),
    email: session?.user?.email || '',
    syncing,
    lastSynced,
    error: lastError
  };
}

function notify(patch = {}) {
  if ('error' in patch) lastError = patch.error || '';
  onStatus(status());
}

function customerRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    name: item.name,
    area: item.area || '',
    customer_type: item.type || 'Other',
    address: item.address || '',
    contact_name: item.contact || '',
    contact_role: item.role || '',
    email: item.email || '',
    phone: item.phone || '',
    last_visit: item.lastVisit || null,
    opportunity: item.opportunity || '',
    opportunity_value: Number(item.value) || 0,
    latitude: numberOrNull(item.lat),
    longitude: numberOrNull(item.lng)
  };
}

function visitRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    customer_id: item.customerId,
    started_at: item.start,
    ended_at: item.end,
    latitude: numberOrNull(item.lat),
    longitude: numberOrNull(item.lng),
    summary: item.summary || '',
    products: item.products || [],
    outcome: item.outcome || '',
    next_action: item.nextAction || '',
    follow_up_at: item.followUp || null,
    source: item.source || 'typed'
  };
}

function taskRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    customer_id: item.customerId,
    title: item.title,
    due_at: item.due,
    completed: Boolean(item.done),
    priority: item.priority || 'Next'
  };
}

function productRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    sku: item.sku || '',
    name: item.name,
    brand: item.brand || '',
    product_range: item.range || '',
    pack_count: numberOrNull(item.packCount),
    size: item.size || '',
    pack: item.pack || '',
    ex_case: numberOrNull(item.exCase),
    ex_unit: numberOrNull(item.exUnit),
    case_price: numberOrNull(item.price),
    unit_price: numberOrNull(item.unitPrice),
    price_indicator: item.priceIndicator || '',
    case_barcode: item.caseBarcode || '',
    unit_barcode: item.unitBarcode || '',
    pack_barcode: item.packBarcode || '',
    availability: item.availability || '',
    vat: item.vat !== false,
    active: item.active !== false
  };
}

function tripRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    started_at: item.start,
    ended_at: item.end,
    points: item.points || [],
    from_customer_id: item.fromCustomerId || null,
    to_customer_id: item.toCustomerId || null,
    from_label: item.fromLabel || '',
    to_label: item.toLabel || '',
    distance_km: Number(item.distanceKm) || 0,
    rate_per_km: Number(item.ratePerKm) || 4.9,
    reimbursement: Number(item.reimbursement) || 0
  };
}

function rowsFor(data, userId) {
  return {
    customers: (data.customers || []).map(item => customerRow(item, userId)),
    visits: (data.visits || []).map(item => visitRow(item, userId)),
    tasks: (data.tasks || []).map(item => taskRow(item, userId)),
    products: (data.products || []).map(item => productRow(item, userId)),
    travel_trips: (data.travel?.trips || []).map(item => tripRow(item, userId))
  };
}

async function syncRows(table, rows, userId, force = false, generation = identityGeneration) {
  const nextHash = hash(rows);
  if (!force && lastHashes[table] === nextHash) return;
  assertCurrentIdentity(userId, generation);

  const { data: existing, error: readError } = await client
    .from(table)
    .select('id')
    .eq('user_id', userId);
  if (readError) throw readError;
  assertCurrentIdentity(userId, generation);

  const nextIds = new Set(rows.map(row => row.id));
  const removedIds = (existing || []).map(row => row.id).filter(id => !nextIds.has(id));
  if (removedIds.length) {
    const { error } = await client.from(table).delete().eq('user_id', userId).in('id', removedIds);
    if (error) throw error;
    assertCurrentIdentity(userId, generation);
  }
  if (rows.length) {
    const { error } = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw error;
    assertCurrentIdentity(userId, generation);
  }
  lastHashes[table] = nextHash;
}

export async function syncCloudNow(force = false) {
  const data = getLocalData();
  const userId = session?.user?.id;
  const generation = identityGeneration;
  if (!configured || !identityReady || !userId || !data || syncing || !navigator.onLine) return false;

  syncing = true;
  notify({ error: '' });
  try {
    assertCurrentIdentity(userId, generation);
    const profile = {
      user_id: userId,
      display_name: data.profile?.name || '',
      initials: data.profile?.initials || '',
      territory: data.profile?.territory || '',
      rate_per_km: Number(data.travel?.ratePerKm) || 4.9
    };
    const profileHash = hash(profile);
    if (force || lastHashes.profiles !== profileHash) {
      const { error } = await client.from('profiles').upsert(profile, { onConflict: 'user_id' });
      if (error) throw error;
      assertCurrentIdentity(userId, generation);
      lastHashes.profiles = profileHash;
    }

    const tables = rowsFor(data, userId);
    await syncRows('customers', tables.customers, userId, force, generation);
    await Promise.all([
      syncRows('visits', tables.visits, userId, force, generation),
      syncRows('tasks', tables.tasks, userId, force, generation),
      syncRows('products', tables.products, userId, force, generation),
      syncRows('travel_trips', tables.travel_trips, userId, force, generation)
    ]);
    assertCurrentIdentity(userId, generation);

    const appState = {
      user_id: userId,
      active_visit: data.activeVisit || null,
      active_trip: data.travel?.activeTrip || null,
      last_position: data.travel?.lastPosition || null,
      chat: data.chat || []
    };
    const appStateHash = hash(appState);
    if (force || lastHashes.app_state !== appStateHash) {
      const { error } = await client.from('app_state').upsert(appState, { onConflict: 'user_id' });
      if (error) throw error;
      assertCurrentIdentity(userId, generation);
      lastHashes.app_state = appStateHash;
    }

    lastSynced = new Date().toISOString();
    return true;
  } catch (error) {
    if (error instanceof StaleIdentityError) return false;
    lastError = error?.message || 'Cloud sync failed';
    return false;
  } finally {
    syncing = false;
    notify();
  }
}

export function scheduleCloudSync() {
  if (!session?.user || !navigator.onLine) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncCloudNow(false), 900);
}

function fromCustomer(row) {
  return { id:row.id, name:row.name, area:row.area, type:row.customer_type, address:row.address, contact:row.contact_name, role:row.contact_role, email:row.email, phone:row.phone, lastVisit:row.last_visit, opportunity:row.opportunity, value:Number(row.opportunity_value)||0, lat:numberOrNull(row.latitude), lng:numberOrNull(row.longitude) };
}

function fromVisit(row) {
  return { id:row.id, customerId:row.customer_id, start:row.started_at, end:row.ended_at, lat:numberOrNull(row.latitude), lng:numberOrNull(row.longitude), summary:row.summary, products:row.products||[], outcome:row.outcome, nextAction:row.next_action, followUp:row.follow_up_at, source:row.source };
}

function fromTask(row) {
  return { id:row.id, customerId:row.customer_id, title:row.title, due:row.due_at, done:row.completed, priority:row.priority };
}

function fromProduct(row) {
  return { id:row.id, sku:row.sku, name:row.name, brand:row.brand, range:row.product_range, packCount:row.pack_count, size:row.size, pack:row.pack, exCase:numberOrNull(row.ex_case), exUnit:numberOrNull(row.ex_unit), price:numberOrNull(row.case_price), unitPrice:numberOrNull(row.unit_price), priceIndicator:row.price_indicator, caseBarcode:row.case_barcode, unitBarcode:row.unit_barcode, packBarcode:row.pack_barcode, availability:row.availability, vat:row.vat, active:row.active };
}

function fromTrip(row) {
  return { id:row.id, start:row.started_at, end:row.ended_at, points:row.points||[], fromCustomerId:row.from_customer_id, toCustomerId:row.to_customer_id, fromLabel:row.from_label, toLabel:row.to_label, distanceKm:Number(row.distance_km)||0, ratePerKm:Number(row.rate_per_km)||4.9, reimbursement:Number(row.reimbursement)||0 };
}

async function loadRemoteOrSeed() {
  const userId = session?.user?.id;
  const generation = identityGeneration;
  if (!userId) return;
  syncing = true;
  notify({ error: '' });
  try {
    const profileResult = await client.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    assertCurrentIdentity(userId, generation);
    if (!profileResult.data) {
      syncing = false;
      await syncCloudNow(true);
      return;
    }

    const [customers, visits, tasks, products, trips, appState] = await Promise.all([
      client.from('customers').select('*').eq('user_id', userId).order('name'),
      client.from('visits').select('*').eq('user_id', userId).order('started_at'),
      client.from('tasks').select('*').eq('user_id', userId).order('due_at'),
      client.from('products').select('*').eq('user_id', userId).order('name'),
      client.from('travel_trips').select('*').eq('user_id', userId).order('started_at'),
      client.from('app_state').select('*').eq('user_id', userId).maybeSingle()
    ]);
    const failed = [customers, visits, tasks, products, trips, appState].find(result => result.error);
    if (failed) throw failed.error;
    assertCurrentIdentity(userId, generation);

    const current = getLocalData();
    const remote = {
      profile: { name:profileResult.data.display_name, initials:profileResult.data.initials, territory:profileResult.data.territory },
      customers: customers.data.map(fromCustomer),
      visits: visits.data.map(fromVisit),
      tasks: tasks.data.map(fromTask),
      products: products.data.length ? products.data.map(fromProduct) : current.products,
      travel: {
        ...current.travel,
        ratePerKm: Number(profileResult.data.rate_per_km) || 4.9,
        trips: trips.data.map(fromTrip),
        activeTrip: appState.data?.active_trip || null,
        lastPosition: appState.data?.last_position || null
      },
      activeVisit: appState.data?.active_visit || null,
      chat: appState.data?.chat?.length ? appState.data.chat : current.chat
    };
    assertCurrentIdentity(userId, generation);
    setLocalData(remote);
    const normalized = rowsFor(remote, userId);
    lastHashes = {
      profiles: hash({ user_id:userId, display_name:remote.profile.name, initials:remote.profile.initials, territory:remote.profile.territory, rate_per_km:remote.travel.ratePerKm }),
      customers: hash(normalized.customers),
      visits: hash(normalized.visits),
      tasks: hash(normalized.tasks),
      products: hash(normalized.products),
      travel_trips: hash(normalized.travel_trips),
      app_state: hash({ user_id:userId, active_visit:remote.activeVisit, active_trip:remote.travel.activeTrip, last_position:remote.travel.lastPosition, chat:remote.chat })
    };
    lastSynced = new Date().toISOString();
  } catch (error) {
    if (error instanceof StaleIdentityError) return;
    lastError = error?.message || 'Could not load cloud data';
  } finally {
    syncing = false;
    notify();
  }
}

async function handleSession(nextSession) {
  const nextUserId = nextSession?.user?.id || null;
  session = nextSession;
  if (activeUserId !== nextUserId) {
    identityReady = false;
    clearTimeout(syncTimer);
    syncTimer = null;
    handledUserId = null;
    lastHashes = {};
    lastSynced = null;
    activeUserId = nextUserId;
    identityGeneration += 1;
    await onIdentityChange(session?.user || null);
    identityReady = true;
  }
  notify({ error: '' });
  if (!session?.user) {
    return;
  }
  if (handledUserId === session.user.id) return;
  handledUserId = session.user.id;
  await loadRemoteOrSeed();
}

function queueSessionChange(nextSession) {
  sessionChangeChain = sessionChangeChain
    .then(() => handleSession(nextSession))
    .catch(error => notify({ error:error?.message || 'Could not change cloud account' }));
  return sessionChangeChain;
}

export async function initializeCloud(options) {
  getLocalData = options.getData;
  setLocalData = options.setData;
  onIdentityChange = options.onIdentityChange || onIdentityChange;
  onStatus = options.onStatus;
  notify();
  if (!configured) {
    await handleSession(null);
    return;
  }

  const { data, error } = await client.auth.getSession();
  if (error) notify({ error:error.message });
  await handleSession(data?.session || null);
  client.auth.onAuthStateChange((_event, nextSession) => {
    queueMicrotask(() => queueSessionChange(nextSession));
  });
}

export async function signInWithEmail(email, password) {
  if (!client) throw new Error('Cloud connection is not configured on this device.');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOutCloud() {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  await queueSessionChange(null);
}
