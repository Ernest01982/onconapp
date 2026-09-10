import { fingerprint, syncDecision, mergeRecords } from './sync-safety.js';
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
let checkpoint = () => {};
let cloudLoaded = false;
let onIdentityChange = async () => {};
let onStatus = () => {};
let syncTimer = null;
let syncing = false;
let lastSynced = null;
let lastError = '';
let handledUserId = null;
let activeUserId;
let identityGeneration = 0;
let identityReady = false;
let sessionChangeChain = Promise.resolve();

class StaleIdentityError extends Error {}

function assertCurrentIdentity(userId, generation) {
  if (!identityReady || activeUserId !== userId || identityGeneration !== generation) throw new StaleIdentityError();
}

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
    longitude: numberOrNull(item.lng),
    menu_change_date: item.menuChangeDate || null,
    menu_change_month: item.menuChangeMonth || '',
    listings_reopen_at: item.listingsReopenAt || null,
    listings_reopen_month: item.listingsReopenMonth || '',
    listing_reminder_days: Number(item.listingReminderDays) || 60,
    listing_cycle_notes: item.listingCycleNotes || '',
    ...(item.createdAt ? { created_at:item.createdAt } : {})
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
    raw_note: item.rawNote ?? null,
    products: item.products || [],
    outcome: item.outcome || '',
    next_action: item.nextAction || '',
    follow_up_at: item.followUp || null,
    source: item.source || 'typed',
    wine_outcomes: item.wineOutcomes || [],
    contact_snapshot: item.contactSnapshot || {},
    feedback_outcome: item.feedbackOutcome || item.outcome || '',
    current_wine_ids: item.currentWineIds || [],
    samples_left_wine_ids: item.samplesLeftWineIds || [],
    follow_up_required: Boolean(item.followUpRequired),
    follow_up_reason: item.followUpReason || '',
    follow_up_contact: item.followUpContact || '',
    follow_up_task_id: item.followUpTaskId || null,
    follow_up_completed: Boolean(item.followUpCompleted),
    menu_change_date: item.menuChangeDate || null,
    menu_change_month: item.menuChangeMonth || '',
    listings_reopen_at: item.listingsReopenAt || null,
    listings_reopen_month: item.listingsReopenMonth || '',
    listing_reminder_days: Number(item.listingReminderDays) || 60
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
    completed_at: item.completedAt || null,
    priority: item.priority || 'Next',
    wine_id: item.wineId || null,
    visit_id: item.visitId || null,
    reminder_type: item.reminderType || 'followup',
    reason: item.reason || item.title || '',
    contact_person: item.contactPerson || '',
    reschedule_history: item.rescheduleHistory || []
  };
}

function customerWineRow(item, userId) {
  return {
    user_id: userId,
    id: item.id,
    customer_id: item.customerId,
    wine_id: item.wineId,
    status: item.status || 'Discussed',
    interest_started_at: item.interestStartedAt || null,
    sampled_at: item.sampledAt || null,
    listing_date: item.listingDate || null,
    delisting_date: item.delistingDate || null,
    allocation: item.allocation || '',
    notes: item.notes || '',
    follow_up_at: item.followUpAt || null,
    status_history: item.history || [],
    ...(item.createdAt ? { created_at:item.createdAt } : {})
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
    reimbursement: Number(item.reimbursement) || 0,
    customer_id: item.customerId || null,
    purpose: item.purpose || 'Business travel',
    start_odometer: numberOrNull(item.startOdometer),
    end_odometer: numberOrNull(item.endOdometer),
    notes: item.notes || '',
    distance_source: item.distanceSource || 'gps'
  };
}

function rowsFor(data, userId) {
  return {
    customers: (data.customers || []).map(item => customerRow(item, userId)),
    visits: (data.visits || []).map(item => visitRow(item, userId)),
    tasks: (data.tasks || []).map(item => taskRow(item, userId)),
    products: (data.products || []).map(item => productRow(item, userId)),
    customer_wines: (data.customerWines || []).map(item => customerWineRow(item, userId)),
    travel_trips: (data.travel?.trips || []).map(item => tripRow(item, userId))
  };
}

const mappers = {
  customers: row=>customerRow(fromCustomer(row), row.user_id),
  products: row=>productRow(fromProduct(row), row.user_id),
  visits: row=>visitRow(fromVisit(row), row.user_id),
  tasks: row=>taskRow(fromTask(row), row.user_id),
  customer_wines: row=>customerWineRow(fromCustomerWine(row), row.user_id),
  travel_trips: row=>tripRow(fromTrip(row), row.user_id),
  profiles: ({user_id,display_name,initials,territory,rate_per_km})=>({user_id,display_name,initials,territory,rate_per_km:Number(rate_per_km)}),
  app_state: ({user_id,active_visit,active_trip,last_position,chat})=>({user_id,active_visit,active_trip,last_position,chat})
};
async function readRows(table,userId){
  const rows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await client.from(table).select('*').eq('user_id',userId).order(table==='profiles'||table==='app_state'?'user_id':'id').range(offset,offset+499);
    if(error)throw error;
    rows.push(...data);
    if(data.length<500)return {data:rows};
  }
}
async function syncRows(table, rows, userId, force = false, generation = identityGeneration) {
  assertCurrentIdentity(userId,generation);
  const existing=(await readRows(table,userId)).data;
  assertCurrentIdentity(userId,generation);
  const key=table==='profiles'||table==='app_state'?'user_id':'id';
  const remote=new Map(existing.map(row=>[row[key],{row:mappers[table](row),version:row.updated_at}]));
  const metadata=getLocalData()._syncBase ||= {};
  const baseline=metadata[table] ||= {};
  const local=new Map(rows.map(row=>[row[key],row]));
  if([...remote.keys()].some(id=>!local.has(id)&&!baseline[id]))throw new Error('New cloud records are available. Tap Sync now to load them safely.');
  for(const id of new Set([...local.keys(),...Object.keys(baseline)])){
    const row=local.get(id),other=remote.get(id),base=baseline[id];
    const decision=syncDecision(row,other,base);
    if(decision==='conflict')throw new Error('Sync paused: '+table+' has a different cloud copy. Your device changes are kept. Download a backup before reviewing differences.');
    if(decision==='ack'){baseline[id]={fingerprint:fingerprint(row),version:other.version};continue;}
    if(decision==='none'){delete baseline[id];continue;}
    if(decision==='remote')throw new Error('New cloud changes are available. Tap Sync now to merge them safely.');
    // Never cascade a stale parent deletion into another device's new child records.
    if(decision==='delete'&&['customers','products'].includes(table))throw new Error('Cloud deletion paused to protect linked history. Restore this client/product from backup or archive it instead.');
    let request=client.from(table);
    if(decision==='insert')request=request.insert(row);
    else {
      request=decision==='delete'?request.delete():request.update(row);
      request=request.eq(key,id).eq('user_id',userId).eq('updated_at',base.version);
    }
    const result=await request.select('*');
    if(result.error)throw result.error;
    assertCurrentIdentity(userId,generation);
    if(result.data?.length!==1)throw new Error('A cloud record changed during sync. Your local changes are kept; sync again to review.');
    if(decision==='delete')delete baseline[id];
    else baseline[id]={fingerprint:fingerprint(row),version:result.data[0].updated_at};
    checkpoint();
  }
  checkpoint();
}

export async function syncCloudNow(force = false) {
  const data = JSON.parse(JSON.stringify(getLocalData()));
  const userId = session?.user?.id;
  const generation = identityGeneration;
  if (!configured || !identityReady || !userId || !data || syncing || !navigator.onLine) return false;

  if(!cloudLoaded){await loadRemoteOrSeed();return cloudLoaded&&!lastError?syncCloudNow():false;}
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
    await syncRows('profiles',[profile],userId,force,generation);

    const tables = rowsFor(data, userId);
    await syncRows('customers', tables.customers, userId, force, generation);
    await syncRows('products', tables.products, userId, force, generation);
    for(const table of ['visits','tasks','customer_wines','travel_trips'])await syncRows(table,tables[table],userId,force,generation);
    assertCurrentIdentity(userId, generation);

    const appState = {
      user_id: userId,
      active_visit: data.activeVisit || null,
      active_trip: data.travel?.activeTrip || null,
      last_position: data.travel?.lastPosition || null,
      chat: data.chat || []
    };
    await syncRows('app_state',[appState],userId,force,generation);

    lastSynced = new Date().toISOString();
    const latest={...getLocalData(),_syncBase:null},snapshot={...data,_syncBase:null};
    if(fingerprint(latest)!==fingerprint(snapshot))scheduleCloudSync();
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
  return { id:row.id, name:row.name, area:row.area, type:row.customer_type, address:row.address, contact:row.contact_name, role:row.contact_role, email:row.email, phone:row.phone, lastVisit:row.last_visit, opportunity:row.opportunity, value:Number(row.opportunity_value)||0, lat:numberOrNull(row.latitude), lng:numberOrNull(row.longitude), menuChangeDate:row.menu_change_date, menuChangeMonth:row.menu_change_month||'', listingsReopenAt:row.listings_reopen_at, listingsReopenMonth:row.listings_reopen_month||'', listingReminderDays:Number(row.listing_reminder_days)||60, listingCycleNotes:row.listing_cycle_notes||'', createdAt:row.created_at };
}

function fromVisit(row) {
  return { id:row.id, customerId:row.customer_id, start:row.started_at, end:row.ended_at, lat:numberOrNull(row.latitude), lng:numberOrNull(row.longitude), summary:row.summary, rawNote:row.raw_note, products:row.products||[], outcome:row.outcome, nextAction:row.next_action, followUp:row.follow_up_at, source:row.source, wineOutcomes:row.wine_outcomes||[], contactSnapshot:row.contact_snapshot||{}, feedbackOutcome:row.feedback_outcome||row.outcome, currentWineIds:row.current_wine_ids||[], samplesLeftWineIds:row.samples_left_wine_ids||[], followUpRequired:Boolean(row.follow_up_required), followUpReason:row.follow_up_reason||'', followUpContact:row.follow_up_contact||'', followUpTaskId:row.follow_up_task_id||null, followUpCompleted:Boolean(row.follow_up_completed), menuChangeDate:row.menu_change_date, menuChangeMonth:row.menu_change_month||'', listingsReopenAt:row.listings_reopen_at, listingsReopenMonth:row.listings_reopen_month||'', listingReminderDays:Number(row.listing_reminder_days)||60 };
}

function fromTask(row) {
  return { id:row.id, customerId:row.customer_id, title:row.title, due:row.due_at, done:row.completed, completedAt:row.completed_at, priority:row.priority, wineId:row.wine_id, visitId:row.visit_id, reminderType:row.reminder_type||'followup', reason:row.reason||row.title, contactPerson:row.contact_person||'', rescheduleHistory:row.reschedule_history||[] };
}

function fromCustomerWine(row) {
  return { id:row.id, customerId:row.customer_id, wineId:row.wine_id, status:row.status, interestStartedAt:row.interest_started_at, sampledAt:row.sampled_at, listingDate:row.listing_date, delistingDate:row.delisting_date, allocation:row.allocation, notes:row.notes, followUpAt:row.follow_up_at, history:row.status_history||[], createdAt:row.created_at, updatedAt:row.updated_at };
}

function fromProduct(row) {
  return { id:row.id, sku:row.sku, name:row.name, brand:row.brand, range:row.product_range, packCount:row.pack_count, size:row.size, pack:row.pack, exCase:numberOrNull(row.ex_case), exUnit:numberOrNull(row.ex_unit), price:numberOrNull(row.case_price), unitPrice:numberOrNull(row.unit_price), priceIndicator:row.price_indicator, caseBarcode:row.case_barcode, unitBarcode:row.unit_barcode, packBarcode:row.pack_barcode, availability:row.availability, vat:row.vat, active:row.active };
}

function fromTrip(row) {
  return { id:row.id, start:row.started_at, end:row.ended_at, points:row.points||[], fromCustomerId:row.from_customer_id, toCustomerId:row.to_customer_id, fromLabel:row.from_label, toLabel:row.to_label, distanceKm:Number(row.distance_km)||0, ratePerKm:Number(row.rate_per_km)||4.9, reimbursement:Number(row.reimbursement)||0, customerId:row.customer_id, purpose:row.purpose||'Business travel', startOdometer:numberOrNull(row.start_odometer), endOdometer:numberOrNull(row.end_odometer), notes:row.notes||'', distanceSource:row.distance_source||'gps' };
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
      cloudLoaded = true;
      syncing = false;
      await syncCloudNow(true);
      return;
    }

    const [customers, visits, tasks, products, customerWines, trips, appState] = await Promise.all([
      readRows('customers', userId),
      readRows('visits', userId),
      readRows('tasks', userId),
      readRows('products', userId),
      readRows('customer_wines', userId),
      readRows('travel_trips', userId),
      client.from('app_state').select('*').eq('user_id', userId).maybeSingle()
    ]);
    const failed = [customers, visits, tasks, products, customerWines, trips, appState].find(result => result.error);
    if (failed) throw failed.error;
    assertCurrentIdentity(userId, generation);

    const current = getLocalData();
    const remote = {
      profile: { name:profileResult.data.display_name, initials:profileResult.data.initials, territory:profileResult.data.territory },
      customers: customers.data.map(fromCustomer),
      visits: visits.data.map(fromVisit),
      tasks: tasks.data.map(fromTask),
      products: products.data.length ? products.data.map(fromProduct) : current.products,
      customerWines: customerWines.data.map(fromCustomerWine),
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
    const metadata=JSON.parse(JSON.stringify(current._syncBase||{}));
    const configs=[
      ['customers','customers',customers,fromCustomer,customerRow],
      ['visits','visits',visits,fromVisit,visitRow],
      ['tasks','tasks',tasks,fromTask,taskRow],
      ['products','products',products,fromProduct,productRow],
      ['customer_wines','customerWines',customerWines,fromCustomerWine,customerWineRow],
      ['travel_trips','trips',trips,fromTrip,tripRow]
    ];
    for(const [table,field,result,from,to] of configs){
      const local=field==='trips'?current.travel.trips:current[field]||[];
      const merged=mergeRecords(local,result.data.map(row=>({item:from(row),version:row.updated_at})),metadata[table],item=>to(item,userId));
      if(field==='trips')remote.travel.trips=merged.items;else remote[field]=merged.items;
      metadata[table]=merged.baselines;
    }
    // Merge singleton records with the same conflict rules as visits.
    const localProfile={user_id:userId,display_name:current.profile.name,initials:current.profile.initials,territory:current.profile.territory,rate_per_km:current.travel.ratePerKm};
    const localState={user_id:userId,active_visit:current.activeVisit||null,active_trip:current.travel.activeTrip||null,last_position:current.travel.lastPosition||null,chat:current.chat||[]};
    for(const [table,localRow,raw] of [['profiles',localProfile,profileResult.data],['app_state',localState,appState.data]]){
      const base=metadata[table]?.[userId];
      const other=raw&&{row:mappers[table](raw),version:raw.updated_at};
      let decision=syncDecision(localRow,other,base);
      // A clean first-use profile/draft can safely adopt the server copy.
      if(!base&&!current.customers.length&&!current.visits.length&&!current.activeVisit&&!current.travel.activeTrip)decision='remote';
      if(['remote','ack'].includes(decision)&&raw){
        metadata[table]={[userId]:{fingerprint:fingerprint(other.row),version:raw.updated_at}};
      }else if(table==='profiles'){
        remote.profile=current.profile;remote.travel.ratePerKm=current.travel.ratePerKm;
      }else {
        remote.activeVisit=current.activeVisit;remote.travel.activeTrip=current.travel.activeTrip;remote.travel.lastPosition=current.travel.lastPosition;remote.chat=current.chat;
      }
    }
    remote._syncBase=metadata;
    setLocalData(remote);
    cloudLoaded=true;


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
    cloudLoaded = false;
    clearTimeout(syncTimer);
    syncTimer = null;
    handledUserId = null;
    pendingDifferences.clear();
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
  if(cloudLoaded&&!lastError)scheduleCloudSync();
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
  checkpoint = options.checkpoint || (()=>{});
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


export async function refreshCloud(){
  if(syncing||!navigator.onLine)return false;
  await loadRemoteOrSeed();
  if(lastError)return false;
  return syncCloudNow();
}
const recordConfigs={
  customers:['customers',fromCustomer,customerRow], visits:['visits',fromVisit,visitRow],
  tasks:['tasks',fromTask,taskRow], products:['products',fromProduct,productRow],
  customer_wines:['customerWines',fromCustomerWine,customerWineRow],
  travel_trips:['trips',fromTrip,tripRow]
};
const pendingDifferences=new Map();
function allLocalRows(workspace,userId){
  return {...rowsFor(workspace,userId),
    profiles:[{user_id:userId,display_name:workspace.profile.name,initials:workspace.profile.initials,territory:workspace.profile.territory,rate_per_km:workspace.travel.ratePerKm}],
    app_state:[{user_id:userId,active_visit:workspace.activeVisit||null,active_trip:workspace.travel.activeTrip||null,last_position:workspace.travel.lastPosition||null,chat:workspace.chat||[]}]
  };
}
export async function reviewCloudDifferences(){
  const userId=session?.user?.id,generation=identityGeneration;
  if(!userId||syncing)throw new Error('Wait for sync to finish, then try again.');
  const results=[];pendingDifferences.clear();
  for(const table of Object.keys(mappers)){
    const raw=(await readRows(table,userId)).data;
    assertCurrentIdentity(userId,generation);
    const key=recordConfigs[table]?'id':'user_id';
    const local=new Map(allLocalRows(getLocalData(),userId)[table].map(row=>[row[key],row]));
    const remote=new Map(raw.map(row=>[row[key],row]));
    const baselines=getLocalData()._syncBase?.[table]||{};
    for(const id of new Set([...local.keys(),...Object.keys(baselines)])){
      const here=local.get(id),there=remote.get(id);
      const other=there&&{row:mappers[table](there),version:there.updated_at};
      if(syncDecision(here,other,baselines[id])!=='conflict')continue;
      const token=table+':'+id;
      pendingDifferences.set(token,{table,id,here,there,userId,generation});
      results.push({token,title:(here?.name||here?.title||here?.summary||table.replaceAll('_',' ')),local:here||null,cloud:other?.row||null});
    }
  }
  return results;
}
export async function resolveCloudDifference(token,choice){
  const item=pendingDifferences.get(token);
  if(!item)throw new Error('Review the differences again before choosing.');
  const {table,id,here,there,userId,generation}=item;
  assertCurrentIdentity(userId,generation);
  const key=recordConfigs[table]?'id':'user_id';
  const latest=allLocalRows(getLocalData(),userId)[table].find(row=>row[key]===id);
  if(fingerprint(latest)!==fingerprint(here))throw new Error('This device record changed. Review again.');
  const raw=(await readRows(table,userId)).data.find(row=>row[key]===id);
  assertCurrentIdentity(userId,generation);
  if(raw?.updated_at!==there?.updated_at)throw new Error('The cloud copy changed. Review again.');
  const current=JSON.parse(JSON.stringify(getLocalData()));
  const bases=current._syncBase ||= {};bases[table] ||= {};
  if(raw)bases[table][id]={fingerprint:fingerprint(mappers[table](raw)),version:raw.updated_at};
  else delete bases[table][id];
  if(choice==='cloud'){
    if(recordConfigs[table]){
      const [field,from]=recordConfigs[table],owner=field==='trips'?current.travel:current;
      if(!raw&&['customers','products'].includes(table))throw new Error('Keep the device copy of this parent record to preserve linked history.');
      owner[field]=owner[field].filter(row=>row.id!==id);
      if(raw)owner[field].push(from(raw));
    }else if(table==='profiles'&&raw){
      current.profile={name:raw.display_name,initials:raw.initials,territory:raw.territory};current.travel.ratePerKm=Number(raw.rate_per_km);
    }else if(table==='app_state'){
      current.activeVisit=raw?.active_visit||null;current.travel.activeTrip=raw?.active_trip||null;current.travel.lastPosition=raw?.last_position||null;current.chat=raw?.chat||[];
    }
  }else if(choice!=='device')throw new Error('Choose a device or cloud copy.');
  setLocalData(current);
  pendingDifferences.delete(token);
  notify({error:''});
}
