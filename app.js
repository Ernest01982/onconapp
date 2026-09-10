import { realProducts } from './products-data.js';
import { initializeCloud, refreshCloud, reviewCloudDifferences, resolveCloudDifference, scheduleCloudSync, signInWithEmail, signOutCloud, syncCloudNow } from './cloud.js';
import {
  FEEDBACK_OUTCOMES,
  LISTING_REMINDER_DAYS,
  PIPELINE_STATUSES,
  VISIT_WINE_OUTCOMES,
  WINE_STATUSES,
  applyVisitWineOutcomes,
  calculateTripDistance,
  dateRange,
  findCustomerWine,
  groupKm,
  isInRange,
  listingCycleReminders,
  listingCycleTarget,
  normalizeWorkspace,
  taskBuckets,
  upsertCustomerWine
} from './domain.js';
import {
  cloneWorkspace,
  getLegacyDecision,
  getLegacyOwner,
  hasWorkspace,
  importGuestWorkspace,
  migrateLegacyWorkspaceToGuest,
  readWorkspace,
  recordLegacyDecision,
  reserveLegacyWorkspace,
  workspaceKeyFor,
  writeWorkspace
} from './workspace.js';

const DAY = 86_400_000;
const currentDate = () => new Date();
const iso = (offset = 0, hour = 9, minute = 0) => {
  const now = currentDate();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute);
  return d.toISOString();
};

const seed = {
  profile: { name: 'Ernest', initials: 'ER', territory: 'Johannesburg North' },
  customers: [],
  visits: [],
  tasks: [],
  customerWines: [],
  travel: {
    ratePerKm: 4.90,
    activeTrip: null,
    trips: [],
    lastPosition: null
  },
  products: realProducts,
  activeVisit: null,
  chat: [{ role:'ai', text:'Welcome to FieldFlow. Add your first client, then I can help you plan visits and follow-ups.' }]
};

const clone = cloneWorkspace;
const LEGACY_DEMO_CUSTOMERS = new Set(['c1','c2','c3','c4','c5']);
const removeLegacyDemoData = loaded => {
  const cleaned = clone(loaded);
  cleaned.customers = (cleaned.customers || []).filter(item => !LEGACY_DEMO_CUSTOMERS.has(item.id));
  cleaned.visits = (cleaned.visits || []).filter(item => !LEGACY_DEMO_CUSTOMERS.has(item.customerId));
  cleaned.tasks = (cleaned.tasks || []).filter(item => !LEGACY_DEMO_CUSTOMERS.has(item.customerId));
  cleaned.customerWines = (cleaned.customerWines || []).filter(item => !LEGACY_DEMO_CUSTOMERS.has(item.customerId));
  if (LEGACY_DEMO_CUSTOMERS.has(cleaned.activeVisit?.customerId)) cleaned.activeVisit = null;
  if (!cleaned.customers.length && !cleaned.visits.length && !cleaned.tasks.length) cleaned.chat = clone(seed.chat);
  return cleaned;
};
let activeWorkspaceKey = workspaceKeyFor(null);
const loadState = key => normalizeWorkspace(removeLegacyDemoData(readWorkspace(localStorage, key, seed)), realProducts);
migrateLegacyWorkspaceToGuest(localStorage, seed, removeLegacyDemoData);
let data = loadState(activeWorkspaceKey);
let screen = data.activeVisit ? 'visit' : 'home';
let filter = 'All';
let productFilter = 'All';
let productRelationshipFilter = 'All';
let query = '';
let modal = null;
let modalQuery = '';
let pickerContext = null;
let reportPeriod = 'week';
let reportCustomStart = '';
let reportCustomEnd = '';
let travelPeriod = 'month';
let travelCustomStart = '';
let travelCustomEnd = '';
let timerId = null;
let travelTimerId = null;
let locationWatchId = null;
let cloudState = { configured:false, signedIn:false, email:'', syncing:false, lastSynced:null, error:'' };
let deferredInstallPrompt = null;
let appInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isSamsungInternet = /SamsungBrowser/i.test(navigator.userAgent);

let localSaveFailed = false;
let cloudDirty = false;
let tabConflict = false;
let voiceSession = null;
let voiceUndo = null;
const persistLocal = () => {
  try {
    if(tabConflict)throw new Error('Another tab changed this workspace.');
    writeWorkspace(localStorage, activeWorkspaceKey, data);
    localSaveFailed = false;
    document.getElementById('save-warning')?.remove();
  } catch (error) {
    localSaveFailed = true;
    showSaveWarning();
    throw error;
  }
};
function showSaveWarning() {
  if(document.getElementById('save-warning'))return;
  const warning=document.createElement('div');
  warning.id='save-warning';warning.setAttribute('role','alert');
  warning.innerHTML='Changes are NOT saved on this device. Keep this page open. <button data-action="retry-save">Retry save</button> <button data-action="export-backup">Download recovery backup</button>';
  document.body.append(warning);
}
window.addEventListener('storage',event=>{if(event.key===activeWorkspaceKey){tabConflict=true;localSaveFailed=true;showSaveWarning();document.getElementById('save-warning').prepend('Another tab changed this workspace. Download recovery, then reload this tab. ');}});
window.addEventListener('beforeunload',event=>{if(localSaveFailed){event.preventDefault();event.returnValue='';}});
window.addEventListener('unhandledrejection',()=>{if(localSaveFailed)showSaveWarning();});
const save = () => { persistLocal(); cloudDirty=true; scheduleCloudSync(); };
async function activateWorkspace(user) {
  const transition = () => activateWorkspaceUnlocked(user);
  if (navigator.locks?.request) return navigator.locks.request('fieldflow-workspace-transition', transition);
  return transition();
}

function activateWorkspaceUnlocked(user) {
  const userId = user?.id || null;
  const nextKey = workspaceKeyFor(userId);
  const guest = loadState(workspaceKeyFor(null));
  const guestHasWork = guest.customers.length || guest.visits.length || guest.tasks.length || guest.customerWines.length || guest.travel.trips.length || guest.activeVisit || guest.travel.activeTrip;
  if (userId && !hasWorkspace(localStorage, nextKey) && guestHasWork && !getLegacyDecision(localStorage, userId)) {
    const legacyOwner = getLegacyOwner(localStorage);
    if (!legacyOwner || legacyOwner === 'guest' || legacyOwner === userId) {
      const accepted = window.confirm(`FieldFlow found work saved in guest mode.\n\nMove that saved work into ${user.email || 'this signed-in account'}?\n\nChoose Cancel to keep the guest work separate and start this account with an empty CRM.`);
      if (accepted) {
        try { importGuestWorkspace(localStorage, userId, seed, removeLegacyDemoData); }
        catch (error) { recordLegacyDecision(localStorage, userId, 'blocked'); window.alert(error.message); }
      }
      else {
        try { reserveLegacyWorkspace(localStorage, userId, 'skipped'); }
        catch (error) { recordLegacyDecision(localStorage, userId, 'blocked'); window.alert(error.message); }
      }
    } else {
      recordLegacyDecision(localStorage, userId, 'owned-by-another-account');
    }
  }
  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  activeWorkspaceKey = nextKey;
  data = loadState(activeWorkspaceKey);
  persistLocal();
  screen = data.activeVisit ? 'visit' : 'home';
  filter = 'All';
  productFilter = 'All';
  productRelationshipFilter = 'All';
  query = '';
  modal = null;
  render();
}
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const customer = id => data.customers.find(c => c.id === id);
const wine = id => data.products.find(p => p.id === id);
const customerWine = id => data.customerWines.find(item => item.id === id);
const winesForCustomer = id => data.customerWines.filter(item => item.customerId === id);
const customersForWine = id => data.customerWines.filter(item => item.wineId === id);
const currency = value => new Intl.NumberFormat('en-ZA', { style:'currency', currency:'ZAR' }).format(value);
const shortDate = value => new Intl.DateTimeFormat('en-ZA', { day:'numeric', month:'short' }).format(new Date(value));
const time = value => new Intl.DateTimeFormat('en-ZA', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
const dayLabel = value => {
  if (!value) return 'Never';
  const now = currentDate();
  const diff = Math.round((new Date(new Date(value).toDateString()) - new Date(now.toDateString())) / DAY);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  return shortDate(value);
};
const duration = (start, end = new Date()) => {
  const mins = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
const initials = name => name.split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
const radians = degrees => degrees * Math.PI / 180;
const geoDistanceKm = (from, to) => {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) return Infinity;
  const earthKm = 6371;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const routeDistanceKm = points => points.slice(1).reduce((total, point, index) => total + geoDistanceKm(points[index], point), 0);
const hasCustomerLocation = item => Number.isFinite(item?.lat) && Number.isFinite(item?.lng);
const nearestCustomer = position => data.customers.filter(hasCustomerLocation).map(item => ({ customer:item, km:geoDistanceKm(position, {lat:item.lat,lng:item.lng}) })).sort((a,b)=>a.km-b.km)[0] || null;
const reimbursement = km => km * data.travel.ratePerKm;
const todayTrips = () => data.travel.trips.filter(trip => new Date(trip.start).toDateString() === currentDate().toDateString());
const currentTripKm = () => data.travel.activeTrip ? routeDistanceKm(data.travel.activeTrip.points || []) : 0;
const distanceLabel = km => Number.isFinite(km) ? (km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`) : 'Location not pinned';
const storageLabel = () => localSaveFailed?'Not saved':!navigator.onLine?'Working offline':cloudState.error?'Sync needs attention':cloudState.syncing?'Syncing…':cloudState.signedIn&&cloudState.lastSynced&&!cloudDirty?'Cloud backed up':'Saved on device';
const dateInput = value => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};
const dateTimeAtNine = value => value ? new Date(`${value}T09:00:00`).toISOString() : null;
const relationshipTone = status => status === 'Listed' ? 'listed' : status === 'Delisted' || status === 'Not Interested' ? 'inactive' : status === 'Sampled' ? 'sampled' : PIPELINE_STATUSES.includes(status) ? 'pipeline' : '';
const activeListings = () => data.customerWines.filter(item => item.status === 'Listed');
const pendingFollowUps = () => data.tasks.filter(item => !item.done);
const historicalStatus = (relation, status) => relation.status === status || (relation.history || []).some(event => event.status === status);
const wineNames = ids => (ids || []).map(id => wine(id)?.name).filter(Boolean);
const cycleReminders = () => listingCycleReminders(data.customers);
const cycleReminderFor = customerId => cycleReminders().find(item => item.customerId === customerId) || null;
const cycleStateLabel = state => state === 'open' ? 'Listing window open' : state === 'due' ? 'Approaching listing window' : 'Scheduled listing window';

function createFollowUp({ customerId, wineId = null, visitId = null, title, due, reason = '', contactPerson = '' }) {
  const existing = data.tasks.find(task => !task.done && task.customerId === customerId && task.wineId === wineId && task.title === title && task.due === due);
  if (existing) return existing;
  const task = { id:`t${Date.now()}${Math.random().toString(36).slice(2,5)}`, customerId, wineId, visitId, title, due, done:false, completedAt:null, priority:'Next', reminderType:'followup', reason:reason || title, contactPerson, rescheduleHistory:[] };
  data.tasks.push(task);
  return task;
}

const icons = {
  home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  box:'<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
  spark:'<path d="m12 3-1.7 4.3L6 9l4.3 1.7L12 15l1.7-4.3L18 9l-4.3-1.7L12 3Z"/><path d="m5 15-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15Z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  tag:'<path d="M20.6 13.6 11 4H4v7l9.6 9.6a2 2 0 0 0 2.8 0l4.2-4.2a2 2 0 0 0 0-2.8Z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
  pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  x:'<path d="m6 6 12 12M18 6 6 18"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  refresh:'<path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 2 6"/>',
  wifi:'<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
  download:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

function toast(message) {
  const region = document.getElementById('toast-region');
  const item = document.createElement('div'); item.className = 'toast'; item.textContent = message; region.replaceChildren(item);
  setTimeout(() => item.remove(), 2700);
}

function topbar(title, eyebrow = '') {
  return `<header class="topbar"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1></div><button class="avatar" data-action="settings" aria-label="Open profile">${esc(data.profile.initials)}</button></header>`;
}
function nav() {
  const items = [['home','home','Today'],['customers','users','Customers'],['activity','clock','Activity'],['products','box','Products'],['assistant','spark','Ask AI']];
  return `<nav class="bottom-nav" aria-label="Primary">${items.map(([id,ic,label]) => `<button class="nav-btn ${screen===id || (['visit','travel','reports'].includes(screen)&&id==='home')?'active':''}" data-screen="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>`;
}

function homeView() {
  const now = currentDate();
  const pending = data.tasks.filter(t => !t.done).sort((a,b)=>new Date(a.due)-new Date(b.due));
  const todayVisits = data.visits.filter(v => new Date(v.start).toDateString() === now.toDateString());
  const active = data.activeVisit;
  const activeTrip = data.travel.activeTrip;
  const hasCustomers = data.customers.length > 0;
  const todayKm = todayTrips().reduce((sum,trip)=>sum+trip.distanceKm,0);
  const listingReminders = cycleReminders();
  const listingNow = listingReminders.filter(item=>item.state==='open'||item.state==='due');
  return `${topbar(`Good ${now.getHours()<12?'morning':now.getHours()<18?'afternoon':'evening'}`, now.toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'}))}
  <main class="content">
    ${activeTrip ? `<section class="card driving-card"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">Mileage tracking active</span></div><div class="travel-live"><div><strong data-trip-distance>${currentTripKm().toFixed(1)} km</strong><span>Distance</span></div><div><strong data-travel-timer>${duration(activeTrip.start)}</strong><span>Driving time</span></div></div><p>GPS points are saving on this device.</p><button class="btn btn-primary btn-block" data-screen="travel">Open mileage tracker</button></section>` : ''}
    ${active ? `<section class="card active-visit"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">Visit in progress</span></div><div class="timer" data-timer>${duration(active.start)}</div><h2 style="margin:0 0 5px">${esc(customer(active.customerId)?.name)}</h2><p>${esc(customer(active.customerId)?.area)} · location saved</p><button class="btn btn-primary btn-block" data-screen="visit">Open visit</button></section>` : `<section class="card hero"><p class="eyebrow">Your day, made simple</p><h2>${pending.length ? `${pending.length} follow-ups. One clear plan.` : hasCustomers ? 'You’re all caught up.' : 'Add your first client.'}</h2><p>${pending.length ? `Start with ${esc(customer(pending[0].customerId)?.name)}, then keep moving.` : hasCustomers ? 'Start a visit when you arrive at your next customer.' : 'Save the venue and contact once, then every visit becomes quicker.'}</p><div class="hero-actions"><button class="btn btn-primary" data-action="${hasCustomers?'start-visit':'add-customer'}">${icon('plus')} ${hasCustomers?'Start visit':'Add first client'}</button><button class="btn btn-white" data-screen="assistant">${icon('spark')} Ask AI</button></div></section>`}
    ${!appInstalled ? `<section class="card install-card"><div class="install-icon">${icon('download','icon-lg')}</div><div><strong>Put FieldFlow on your phone</strong><span>${isSamsungInternet?'Use Chrome for a Play Protect-safe installation.':'Install it like an app for quick access and offline capture.'}</span></div><button class="btn btn-secondary" data-action="install-app">${isSamsungInternet?'Use Chrome':deferredInstallPrompt?'Install':'Show me how'}</button></section>` : ''}
    <div class="section-row"><h2>Today at a glance</h2><span class="offline-pill ${navigator.onLine?'':'offline'}">${storageLabel()}</span></div>
    <div class="quick-grid">
      <button class="quick-card" data-screen="activity" data-filter="tasks"><span class="quick-icon">${icon('list')}</span><div><strong>${pending.filter(t=>new Date(t.due)<=new Date(iso(0,23,59))).length} follow-ups</strong><span>need attention today</span></div></button>
      <button class="quick-card" data-screen="activity" data-filter="cycles"><span class="quick-icon">${icon('calendar')}</span><div><strong>${listingNow.length} listing windows</strong><span>open or approaching</span></div></button>
      <button class="quick-card" data-screen="activity"><span class="quick-icon">${icon('map')}</span><div><strong>${todayVisits.length} visits</strong><span>${todayVisits.reduce((sum,v)=>sum+(new Date(v.end)-new Date(v.start)),0)/60000 || 0} minutes in trade</span></div></button>
      <button class="quick-card" data-screen="products"><span class="quick-icon">${icon('tag')}</span><div><strong>Price list</strong><span>${data.products.filter(p=>p.active).length} active products</span></div></button>
      <button class="quick-card" data-screen="reports"><span class="quick-icon">${icon('chart')}</span><div><strong>Reports</strong><span>daily, weekly & monthly</span></div></button>
      <button class="quick-card" data-screen="travel"><span class="quick-icon">${icon('pin')}</span><div><strong>${todayKm.toFixed(1)} km</strong><span>${currency(reimbursement(todayKm))} reimbursement today</span></div></button>
      <button class="quick-card" data-action="locate-customers"><span class="quick-icon">${icon('map')}</span><div><strong>Clients near me</strong><span>pinpoint the closest venue</span></div></button>
    </div>
    <div class="section-row"><h2>Next up</h2><button class="text-btn" data-screen="activity" data-filter="tasks">See all</button></div>
    <div class="list">${pending.slice(0,3).map(taskCard).join('') || emptyState('check','Nothing due','You are completely caught up.')}</div>
    ${listingNow.length?`<div class="section-row"><h2>Best listing opportunities</h2><button class="text-btn" data-screen="activity" data-filter="cycles">See windows</button></div><div class="list">${listingNow.slice(0,2).map(listingCycleCard).join('')}</div>`:''}
  </main>${nav()}`;
}

function taskCard(t) {
  const c = customer(t.customerId); const overdue = !t.done && new Date(t.due) < new Date(new Date().setHours(0,0,0,0));
  const product = wine(t.wineId);
  return `<article class="card task-card ${t.done?'done':''}"><button class="check ${t.done?'done':''}" data-action="toggle-task" data-id="${t.id}" aria-label="${t.done?'Reopen':'Complete'} follow-up">${t.done?icon('check'):''}</button><div class="list-card-main"><h3>${esc(t.title)}</h3><p>${esc(c?.name||'Client')} ${product?`· ${esc(product.name)}`:''}${t.contactPerson?` · ${esc(t.contactPerson)}`:''}<br>${esc(t.reason||'Follow-up')} · ${dayLabel(t.due)} at ${time(t.due)}</p></div><div class="task-actions"><div class="date-chip ${overdue?'overdue':''}">${t.done?'Completed':overdue?'Overdue':dayLabel(t.due)}</div><button class="mini-btn" data-action="edit-task" data-id="${t.id}" aria-label="Reschedule or edit follow-up">${t.done?'Edit':'Reschedule'}</button></div></article>`;
}

function listingCycleCard(reminder) {
  const c=customer(reminder.customerId);
  const tone=reminder.state==='open'?'listed':reminder.state==='due'?'hot':'';
  return `<article class="card cycle-card"><div class="cycle-card-main"><span class="status ${tone}">${cycleStateLabel(reminder.state)}</span><h3>${esc(c?.name||'Client')}</h3><p>${reminder.state==='open'?`Window opened ${dayLabel(reminder.targetAt)}`:`Target ${dayLabel(reminder.targetAt)}`} · ${reminder.leadDays}-day reminder${c?.contact?` · ${esc(c.contact)}`:''}</p>${c?.listingCycleNotes?`<small>${esc(c.listingCycleNotes)}</small>`:''}</div><button class="mini-btn" data-action="customer" data-id="${reminder.customerId}">Open</button></article>`;
}

function customersView() {
  const position = data.travel.lastPosition;
  const customerTypes = ['All', ...new Set(data.customers.map(c=>c.type).filter(Boolean))];
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const specialMatch = c => {
    const relations = winesForCustomer(c.id);
    if (filter === 'Listed') return relations.some(item=>item.status==='Listed');
    if (filter === 'Interested') return relations.some(item=>PIPELINE_STATUSES.includes(item.status));
    if (filter === 'Follow-up') return data.tasks.some(item=>!item.done&&item.customerId===c.id);
    if (filter === 'Overdue') return data.tasks.some(item=>!item.done&&item.customerId===c.id&&new Date(item.due)<todayStart);
    if (filter === 'Listing window') { const reminder=cycleReminderFor(c.id); return reminder?.state==='open'||reminder?.state==='due'; }
    return filter === 'All' || c.type === filter;
  };
  const filtered = data.customers.filter(c => `${c.name} ${c.area} ${c.contact}`.toLowerCase().includes(query.toLowerCase()) && specialMatch(c)).sort((a,b)=>position?geoDistanceKm(position,{lat:a.lat,lng:a.lng})-geoDistanceKm(position,{lat:b.lat,lng:b.lng}):String(a.name).localeCompare(String(b.name)));
  const chips = [...customerTypes, 'Listed', 'Interested', 'Follow-up', 'Overdue', 'Listing window'];
  return `${topbar('Customers','Your territory')}<main class="content"><div class="customer-actions"><button class="btn btn-primary" data-action="add-customer">${icon('plus')} Add client</button><button class="btn btn-secondary" data-action="locate-customers">${icon('pin')} ${position?'Refresh location':'Clients near me'}</button></div>${position?`<div class="location-state">${icon('check')}<span>Location captured ${time(position.capturedAt)}. Pinned customers are sorted by distance.</span></div>`:''}<div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search name, area or contact" aria-label="Search customers"></div><div class="filter-row">${chips.map(x=>`<button class="filter-chip ${filter===x?'active':''}" data-action="filter" data-value="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="list">${filtered.map((c,index)=>{const km=position?geoDistanceKm(position,{lat:c.lat,lng:c.lng}):null;const pinned=hasCustomerLocation(c);const listed=winesForCustomer(c.id).filter(item=>item.status==='Listed').length;return `<article class="card customer-card" data-action="customer" data-id="${c.id}" tabindex="0"><div class="customer-top"><div class="dot-icon">${initials(c.name)}</div><div class="list-card-main"><h3>${esc(c.name)}</h3><p>${esc(c.area||'Area not added')} · ${esc(c.type)}</p></div>${icon('arrow')}</div><div class="customer-meta"><span>${position?`${index===0&&pinned?'Nearest · ':''}${distanceLabel(km)}${Number.isFinite(km)?' away':''}`:`${c.lastVisit?`Last visit ${dayLabel(c.lastVisit)}`:'Never visited'}`}</span><span>${listed?`${listed} listed wine${listed===1?'':'s'}`:`${currency(c.value||0)} opportunity`}</span></div></article>`}).join('') || emptyState('search','No matches','Try a different customer, contact or filter.')}</div></main>${nav()}`;
}

function activityView() {
  const mode = filter === 'tasks' ? 'tasks' : filter === 'cycles' ? 'cycles' : 'visits';
  const visits = [...data.visits].sort((a,b)=>new Date(b.start)-new Date(a.start)).filter(v => `${customer(v.customerId)?.name} ${v.summary} ${v.rawNote||''} ${(v.products||[]).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const buckets = taskBuckets(data.tasks);
  const taskSection = (title, items, tone='') => items.length ? `<div class="section-row compact"><h2>${title}</h2><span class="status ${tone}">${items.length}</span></div><div class="list">${items.map(taskCard).join('')}</div>` : '';
  const cycleItems=cycleReminders();
  return `${topbar('Activity','Your field record')}<main class="content"><div class="filter-row"><button class="filter-chip ${mode==='visits'?'active':''}" data-action="activity-mode" data-value="visits">Visits</button><button class="filter-chip ${mode==='tasks'?'active':''}" data-action="activity-mode" data-value="tasks">Follow-ups</button><button class="filter-chip ${mode==='cycles'?'active':''}" data-action="activity-mode" data-value="cycles">Listing windows</button><button class="filter-chip" data-screen="reports">Reports</button></div>
  ${mode==='visits' ? `<div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search visits, notes or products"></div><div class="timeline">${visits.map(v=>{const c=customer(v.customerId);return `<article class="card timeline-item" data-action="visit-detail" data-id="${v.id}" tabindex="0"><span class="timeline-time">${dayLabel(v.start)} · ${time(v.start)} · ${duration(v.start,v.end)}</span><h3>${esc(c?.name)}</h3><p>${esc(v.feedbackOutcome||v.outcome||v.summary)}</p><div class="chip-wrap">${(v.wineOutcomes||[]).slice(0,3).map(item=>`<span class="status ${relationshipTone(item.outcome)}">${esc(wine(item.wineId)?.name||'Wine')} · ${esc(item.outcome)}</span>`).join('')||`<span class="status ${v.outcome?.includes('agreed')?'good':''}">${esc(v.outcome)}</span>`}</div></article>`}).join('') || emptyState('clock','No visits found','Your completed visits will appear here.')}</div>` : mode==='tasks' ? `${taskSection('Overdue',buckets.overdue,'inactive')}${taskSection('Due today',buckets.today,'hot')}${taskSection('Upcoming',buckets.upcoming)}${taskSection('Completed',buckets.completed,'good')}${!data.tasks.length?emptyState('check','No follow-ups','Add a practical next action for a client or wine.'):''}<button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="add-task">${icon('plus')} Add follow-up</button>` : `<div class="location-state">${icon('calendar')}<span>These reminders are separate from normal follow-ups. They identify venues entering their menu or wine-list buying window.</span></div><div class="section-row"><h2>Open or approaching</h2><span class="status hot">${cycleItems.filter(item=>item.state!=='upcoming').length}</span></div><div class="list">${cycleItems.filter(item=>item.state!=='upcoming').map(listingCycleCard).join('')||emptyState('calendar','No listing windows due','Add a menu-change or listings-reopen date to a venue.')}</div><div class="section-row"><h2>Scheduled later</h2></div><div class="list">${cycleItems.filter(item=>item.state==='upcoming').map(listingCycleCard).join('')||emptyState('clock','Nothing scheduled later','Future listing windows will appear here.')}</div>`}
  </main>${nav()}`;
}

function rangeControls(kind, period, customStart, customEnd) {
  return `<div class="filter-row period-row">${[['today','Today'],['week','This week'],['month','This month'],['custom','Custom']].map(([value,label])=>`<button class="filter-chip ${period===value?'active':''}" data-action="${kind}-period" data-value="${value}">${label}</button>`).join('')}</div>${period==='custom'?`<div class="custom-range"><label>From<input class="field" id="${kind}-custom-start" type="date" value="${esc(customStart)}"></label><label>To<input class="field" id="${kind}-custom-end" type="date" value="${esc(customEnd)}"></label><button class="btn btn-secondary" data-action="apply-${kind}-range">Apply</button></div>`:''}`;
}

function tripCard(trip) {
  const from=customer(trip.fromCustomerId); const to=customer(trip.toCustomerId); const account=customer(trip.customerId);
  return `<article class="card trip-card"><div class="trip-card-head"><span class="status">${shortDate(trip.start)} · ${esc(trip.distanceSource||'gps')}</span><button class="mini-btn" data-action="edit-trip" data-id="${trip.id}">Edit</button></div><div class="trip-route"><div class="route-dot"></div><div><span>${time(trip.start)}</span><strong>${esc(from?.name||trip.fromLabel||'Start location')}</strong></div></div><div class="trip-line"></div><div class="trip-route"><div class="route-dot end"></div><div><span>${time(trip.end)}</span><strong>${esc(to?.name||trip.toLabel||account?.name||'End location')}</strong></div></div><p class="trip-purpose">${esc(account?.name||'No account linked')} · ${esc(trip.purpose||'Business travel')}</p>${trip.startOdometer!=null?`<p class="trip-odometer">Odometer ${trip.startOdometer.toFixed(1)} → ${trip.endOdometer.toFixed(1)}</p>`:''}<div class="trip-total"><span>${Number(trip.distanceKm||0).toFixed(1)} km</span><strong>${currency(Number(trip.reimbursement)||0)}</strong></div></article>`;
}

function travelView() {
  const active = data.travel.activeTrip;
  const trips = [...data.travel.trips].sort((a,b)=>new Date(b.start)-new Date(a.start));
  let range; try { range=dateRange(travelPeriod,travelCustomStart,travelCustomEnd); } catch { range=dateRange('month'); }
  const filtered = trips.filter(trip=>isInRange(trip.start,range));
  const totalKm = filtered.reduce((sum,trip)=>sum+Number(trip.distanceKm||0),0);
  const totalClaim = filtered.reduce((sum,trip)=>sum+Number(trip.reimbursement||0),0);
  const byAccount = groupKm(filtered,trip=>customer(trip.customerId)?.name||'Unassigned');
  const byDay = groupKm(filtered,trip=>new Date(trip.start).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}));
  const byMonth = groupKm(filtered,trip=>new Date(trip.start).toLocaleDateString('en-ZA',{month:'long',year:'numeric'}));
  const closest = data.travel.lastPosition ? data.customers.filter(hasCustomerLocation).map(item=>({item,km:geoDistanceKm(data.travel.lastPosition,{lat:item.lat,lng:item.lng})})).sort((a,b)=>a.km-b.km).slice(0,3) : [];
  const groupRows = (title,rows)=>rows.length?`<div class="section-row compact"><h2>${title}</h2></div><div class="card summary-list">${rows.slice(0,8).map(row=>`<div class="info-line"><span>${esc(row.label)}</span><strong>${row.km.toFixed(1)} km</strong></div>`).join('')}</div>`:'';
  return `${topbar('Travel & mileage',`${currency(data.travel.ratePerKm)} per kilometre`)}<main class="content">
    ${active ? `<section class="card driving-card"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">GPS route recording</span></div><div class="travel-live"><div><strong data-trip-distance>${currentTripKm().toFixed(1)} km</strong><span>Distance</span></div><div><strong data-travel-timer>${duration(active.start)}</strong><span>Elapsed</span></div></div><p>${active.points.length} accepted GPS points · ${active.lastAccuracy?`±${Math.round(active.lastAccuracy)} m accuracy`:'waiting for location'}</p><button class="btn btn-danger btn-block" data-action="stop-travel">Stop driving & calculate</button></section>` : `<section class="card hero"><p class="eyebrow">Business mileage</p><h2>Track the drive. Keep the proof.</h2><p>Use GPS for live trips or add an odometer trip manually. Reimbursement stays fixed to the rate saved on each trip.</p><div class="hero-actions"><button class="btn btn-primary" data-action="start-travel">${icon('pin')} Start driving</button><button class="btn btn-white" data-action="add-trip">${icon('plus')} Add trip</button></div></section>`}
    <div class="section-row"><h2>KM report</h2><span class="status">Rate ${currency(data.travel.ratePerKm)}/km</span></div>${rangeControls('travel',travelPeriod,travelCustomStart,travelCustomEnd)}
    <div class="metric-grid"><div class="card metric"><span>Business KM</span><strong>${totalKm.toFixed(1)}</strong></div><div class="card metric"><span>Trips</span><strong>${filtered.length}</strong></div><div class="card metric"><span>Reimbursement</span><strong>${currency(totalClaim)}</strong></div><div class="card metric"><span>Accounts</span><strong>${new Set(filtered.map(trip=>trip.customerId).filter(Boolean)).size}</strong></div></div>
    <div class="report-actions"><button class="btn btn-secondary" data-action="export-km">${icon('download')} Export CSV</button><button class="btn btn-ghost" data-action="print-km">Print</button></div>
    <div class="location-state">${icon('pin')}<span><strong>Location privacy:</strong> tracking starts only when you tap Start driving. Keep the PWA open during a GPS trip.</span></div>
    <div class="section-row"><h2>Clients near me</h2><button class="text-btn" data-action="locate-customers">${data.travel.lastPosition?'Refresh':'Locate me'}</button></div>
    <div class="list">${closest.length?closest.map((entry,index)=>`<article class="card list-card" data-action="customer" data-id="${entry.item.id}" tabindex="0"><div class="dot-icon">${index+1}</div><div class="list-card-main"><h3>${esc(entry.item.name)}</h3><p>${esc(entry.item.area)} · ${entry.km<1?`${Math.round(entry.km*1000)} m`:`${entry.km.toFixed(1)} km`} away</p></div>${icon('arrow')}</article>`).join(''):emptyState('pin','Location not captured','Tap Locate me to find the closest saved client.')}</div>
    ${groupRows('KM by account',byAccount)}${groupRows('KM by day',byDay)}${groupRows('KM by month',byMonth)}
    <div class="section-row"><h2>Trip records</h2><span class="status">${filtered.length} shown</span></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>From</th><th>To</th><th>Restaurant</th><th>Business purpose</th><th>KM</th></tr></thead><tbody>${filtered.map(trip=>`<tr><td>${shortDate(trip.start)}</td><td>${esc(customer(trip.fromCustomerId)?.name||trip.fromLabel||'Start')}</td><td>${esc(customer(trip.toCustomerId)?.name||trip.toLabel||'End')}</td><td>${esc(customer(trip.customerId)?.name||'—')}</td><td>${esc(trip.purpose||'Business travel')}</td><td>${Number(trip.distanceKm||0).toFixed(1)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">TOTAL BUSINESS KM</td><td>${totalKm.toFixed(1)} KM</td></tr></tfoot></table></div>
    <div class="section-row"><h2>Trip history</h2><span class="status">${filtered.length} trips</span></div><div class="list">${filtered.length?filtered.map(tripCard).join(''):emptyState('map','No trips in this period','Start driving or add an odometer trip.')}</div>
  </main>${nav()}`;
}

function productsView() {
  const brands = [...new Set(data.products.map(p => p.brand))];
  const products = data.products.filter(p =>
    `${p.name} ${p.sku} ${p.brand} ${p.range} ${p.size} ${p.vintage||''} ${p.variety||''} ${p.caseBarcode} ${p.unitBarcode}`.toLowerCase().includes(query.toLowerCase()) &&
    (productFilter === 'All' || p.brand === productFilter) &&
    (productRelationshipFilter === 'All' || customersForWine(p.id).some(item=>productRelationshipFilter==='Listed'?item.status==='Listed':productRelationshipFilter==='Interested'?PIPELINE_STATUSES.includes(item.status):item.followUpAt&&new Date(item.followUpAt)<=new Date()))
  );
  return `${topbar('Price list','Niew Beverages · On Con')}<main class="content"><div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search wine, producer, variety or vintage"></div><div class="filter-row"><button class="filter-chip ${productRelationshipFilter==='All'?'active':''}" data-action="product-status-filter" data-value="All">All</button><button class="filter-chip ${productRelationshipFilter==='Listed'?'active':''}" data-action="product-status-filter" data-value="Listed">Listed</button><button class="filter-chip ${productRelationshipFilter==='Interested'?'active':''}" data-action="product-status-filter" data-value="Interested">Interested</button><button class="filter-chip ${productRelationshipFilter==='Follow-up'?'active':''}" data-action="product-status-filter" data-value="Follow-up">Follow-up</button></div><div class="filter-row"><button class="filter-chip ${productFilter==='All'?'active':''}" data-action="product-brand" data-value="All">All producers · ${data.products.length}</button>${brands.map(brand=>`<button class="filter-chip ${productFilter===brand?'active':''}" data-action="product-brand" data-value="${esc(brand)}">${esc(brand)} · ${data.products.filter(p=>p.brand===brand).length}</button>`).join('')}</div><div class="hero card compact-hero"><p class="eyebrow">On Con price list · 1 March 2026</p><h2>${productFilter==='All'?'Complete portfolio':esc(productFilter)}</h2><p>${products.length} products shown. Open a wine to see listings and pipeline.</p><div class="hero-actions"><button class="btn btn-primary" data-action="email-pricelist">${icon('mail')} Email this list</button><button class="btn btn-white" data-action="print-pricelist">Print</button></div></div><div class="list">${products.map(p=>{const relations=customersForWine(p.id),listed=relations.filter(item=>item.status==='Listed').length,pipeline=relations.filter(item=>PIPELINE_STATUSES.includes(item.status)).length;return `<article class="card product-card interactive" data-action="product-detail" data-id="${p.id}" tabindex="0"><div class="product-head"><div><h3>${esc(p.name)}</h3><p>${esc(p.sku)} · ${esc(p.brand)} · ${esc(p.range)}</p></div>${listed?`<span class="status listed">${listed} listed</span>`:p.availability==='Confirm availability'?'<span class="status hot">Confirm stock</span>':''}</div><div class="price-pair"><div><span>Case incl. VAT</span><strong>${currency(p.price)}</strong>${p.exCase!=null?`<small>${currency(p.exCase)} excl.</small>`:''}</div><div><span>Unit incl. VAT</span><strong>${p.unitPrice!=null?currency(p.unitPrice):'—'}</strong>${p.exUnit!=null?`<small>${currency(p.exUnit)} excl.</small>`:''}</div></div><div class="product-foot"><span class="status">${esc(p.pack)}</span><span class="wine-counts">${listed} listed · ${pipeline} pipeline</span></div></article>`}).join('') || emptyState('search','No products found','Try another wine, producer, variety, vintage or filter.')}</div></main>${nav()}`;
}

function reportsView() {
  let range; try { range=dateRange(reportPeriod,reportCustomStart,reportCustomEnd); } catch { range=dateRange('week'); }
  const visits=data.visits.filter(v=>isInRange(v.start,range));
  const tasksDue=data.tasks.filter(t=>isInRange(t.due,range));
  const tasksCompleted=data.tasks.filter(t=>t.done&&isInRange(t.completedAt||t.due,range));
  const trips=data.travel.trips.filter(t=>isInRange(t.start,range));
  const km=trips.reduce((sum,t)=>sum+Number(t.distanceKm||0),0);
  const claim=trips.reduce((sum,t)=>sum+Number(t.reimbursement||0),0);
  const mins=visits.reduce((sum,v)=>sum+Math.max(0,(new Date(v.end)-new Date(v.start))/60000),0);
  const newAccounts=data.customers.filter(c=>c.createdAt&&isInRange(c.createdAt,range)).length;
  const listingWindows=cycleReminders();
  const actionableWindows=listingWindows.filter(item=>item.state==='open'||item.state==='due');
  const pipeline=data.customerWines.filter(r=>PIPELINE_STATUSES.includes(r.status));
  const listed=activeListings();
  const newListings=data.customerWines.filter(r=>(r.history||[]).some(event=>event.status==='Listed'&&isInRange(event.at,range))||(!r.history?.length&&r.listingDate&&isInRange(r.listingDate,range)));
  const delistings=data.customerWines.filter(r=>(r.history||[]).some(event=>event.status==='Delisted'&&isInRange(event.at,range))||(!r.history?.length&&r.delistingDate&&isInRange(r.delistingDate,range)));
  const interestedEver=data.customerWines.filter(r=>PIPELINE_STATUSES.some(status=>historicalStatus(r,status)));
  const converted=interestedEver.filter(r=>historicalStatus(r,'Listed')).length;
  const conversion=interestedEver.length?Math.round(converted/interestedEver.length*100):0;
  const discussed=[...new Set(visits.flatMap(v=>(v.wineOutcomes||[]).map(item=>wine(item.wineId)?.name).filter(Boolean)))];
  const countBy=keyFn=>[...listed.reduce((map,item)=>{const key=keyFn(item)||'Unknown';map.set(key,(map.get(key)||0)+1);return map;},new Map())].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count);
  const listingByWine=countBy(r=>wine(r.wineId)?.name);
  const listingByCustomer=countBy(r=>customer(r.customerId)?.name);
  const breakdown=(title,rows,empty)=>`<div class="card info-card"><h3>${title}</h3>${rows.length?rows.slice(0,6).map(row=>`<div class="info-line"><span>${esc(row.label)}</span><strong>${row.count}</strong></div>`).join(''):`<p class="muted-copy">${empty}</p>`}</div>`;
  return `${topbar('Reports','Management snapshot')}<main class="content">${rangeControls('report',reportPeriod,reportCustomStart,reportCustomEnd)}<div class="metric-grid"><div class="card metric"><span>Visits</span><strong>${visits.length}</strong></div><div class="card metric"><span>Accounts visited</span><strong>${new Set(visits.map(v=>v.customerId)).size}</strong></div><div class="card metric"><span>Time in trade</span><strong>${Math.round(mins/60)}h</strong></div><div class="card metric"><span>New accounts</span><strong>${newAccounts}</strong></div><div class="card metric"><span>Follow-ups due</span><strong>${tasksDue.filter(t=>!t.done).length}</strong></div><div class="card metric"><span>Completed</span><strong>${tasksCompleted.length}</strong></div></div>
  <div class="section-row"><h2>Menu / listing cycles</h2><span class="status hot">Opportunity timing</span></div><div class="metric-grid"><div class="card metric"><span>Windows open</span><strong>${listingWindows.filter(item=>item.state==='open').length}</strong></div><div class="card metric"><span>Approaching</span><strong>${listingWindows.filter(item=>item.state==='due').length}</strong></div><div class="card metric"><span>Scheduled later</span><strong>${listingWindows.filter(item=>item.state==='upcoming').length}</strong></div><div class="card metric"><span>Priority venues</span><strong>${actionableWindows.length}</strong></div></div>
  <div class="section-row"><h2>Wine pipeline</h2><span class="status">Current</span></div><div class="metric-grid"><div class="card metric"><span>Interested</span><strong>${pipeline.filter(r=>r.status==='Interested').length}</strong></div><div class="card metric"><span>Sampled</span><strong>${pipeline.filter(r=>r.status==='Sampled').length}</strong></div><div class="card metric"><span>Considering</span><strong>${pipeline.filter(r=>r.status==='Considering').length}</strong></div><div class="card metric"><span>Conversion to listed</span><strong>${conversion}%</strong></div></div>
  <div class="section-row"><h2>Listings</h2><span class="status listed">Confirmed only</span></div><div class="metric-grid"><div class="card metric"><span>Active listings</span><strong>${listed.length}</strong></div><div class="card metric"><span>New in period</span><strong>${newListings.length}</strong></div><div class="card metric"><span>Delistings</span><strong>${delistings.length}</strong></div><div class="card metric"><span>Products discussed</span><strong>${discussed.length}</strong></div></div><div class="list report-breakdowns">${breakdown('Listings by wine',listingByWine,'No confirmed listings yet.')}${breakdown('Listings by restaurant',listingByCustomer,'No confirmed listings yet.')}</div>
  <div class="section-row"><h2>Travel</h2></div><div class="metric-grid"><div class="card metric"><span>Business KM</span><strong>${km.toFixed(1)}</strong></div><div class="card metric"><span>Trips</span><strong>${trips.length}</strong></div><div class="card metric"><span>KM by accounts</span><strong>${new Set(trips.map(t=>t.customerId).filter(Boolean)).size}</strong></div><div class="card metric"><span>Mileage claim</span><strong>${currency(claim)}</strong></div></div>
  <div class="section-row"><h2>Management notes</h2></div><div class="card insight">${icon('spark','icon-lg')}<p><strong>${new Set(visits.map(v=>v.customerId)).size} customers reached.</strong> ${pendingFollowUps().length?`${pendingFollowUps().length} open follow-ups need attention.`:'All committed follow-ups are on track.'} ${actionableWindows.length?`${actionableWindows.length} venues are in or approaching a listing window.`:''} Only confirmed Listed relationships are counted as placements.</p></div><div class="card info-card" style="margin-top:10px"><h3>Products discussed</h3><p class="muted-copy">${discussed.length?discussed.map(esc).join(' · '):'No products logged in this period.'}</p></div><button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="share-report">${icon('mail')} Email this summary</button></main>${nav()}`;
}

function assistantView() {
  return `${topbar('Assistant','Your field co-pilot')}<main class="content"><section class="card assistant-hero"><div class="assistant-mark">${icon('spark','icon-lg')}</div><h2>What do you need?</h2><p>I can use your customers, visits, mileage, follow-ups and listing windows to help plan the day.</p></section><div class="suggestions">${['Who needs follow-up?','Which listing windows are approaching?','What is my mileage claim?','Who have I not visited recently?','What happened at my last visit?','What should I do today?'].map(q=>`<button class="suggestion" data-action="ask" data-value="${esc(q)}">${esc(q)}</button>`).join('')}</div><div class="chat" id="chat">${data.chat.map(m=>`<div class="bubble ${m.role}">${esc(m.text)}</div>`).join('')}</div><form class="ask-row" id="ask-form"><input class="field" id="ask-input" maxlength="1000" placeholder="Ask about your day…" autocomplete="off"><button class="btn btn-primary send-btn" aria-label="Send">${icon('send')}</button></form></main>${nav()}`;
}

function visitView() {
  if (!data.activeVisit) { screen='home'; return homeView(); }
  const active = data.activeVisit;
  const c = customer(active.customerId);
  const structured = structureNote(active.note || '');
  const selected = active.wineOutcomes || [];
  const currentListed=wineNames(active.currentWineIds);
  const interested=selected.filter(item=>['Interested','Considering'].includes(item.outcome)).map(item=>wine(item.wineId)?.name).filter(Boolean);
  const samples=selected.filter(item=>item.sampleLeft).map(item=>wine(item.wineId)?.name).filter(Boolean);
  const contact=active.contactSnapshot||{};
  return `${topbar('Active visit','Capture while it’s fresh')}<main class="content">
    <section class="card active-visit"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">At customer</span></div><div class="timer" data-timer>${duration(active.start)}</div><h2 style="margin:0 0 5px">${esc(contact.placeName||c?.name)}</h2><p>${esc(contact.address||c?.address||c?.area||'Address not added')} · ${active.locationLabel||'location saved'}</p></section>
    <details class="card visit-details"><summary>Contact & venue details</summary><div class="details-body"><div class="form-group"><label>Place name</label><input class="field" data-visit-field="contactPlaceName" maxlength="120" value="${esc(contact.placeName||c?.name||'')}"></div><div class="form-grid"><div class="form-group"><label>Contact person</label><input class="field" data-visit-field="contactPerson" maxlength="120" value="${esc(contact.person||'')}"></div><div class="form-group"><label>Role</label><input class="field" data-visit-field="contactRole" maxlength="80" value="${esc(contact.role||'')}"></div></div><div class="form-group"><label>Address</label><input class="field" data-visit-field="contactAddress" maxlength="500" value="${esc(contact.address||'')}"></div><div class="form-grid"><div class="form-group"><label>Phone</label><input class="field" data-visit-field="contactPhone" type="tel" maxlength="40" value="${esc(contact.phone||'')}"></div><div class="form-group"><label>Email</label><input class="field" data-visit-field="contactEmail" type="email" maxlength="254" value="${esc(contact.email||'')}"></div></div></div></details>
    <div class="section-row"><h2>Current wines listed</h2><span class="status listed">${currentListed.length}</span></div><div class="card compact-card"><p class="muted-copy">${currentListed.length?currentListed.map(esc).join(' · '):'No confirmed listings were recorded when this visit started.'}</p></div>
    <div class="section-row"><h2>Wines presented / discussed</h2><button class="text-btn" data-action="add-visit-wine">${icon('plus')} Add wine</button></div><div class="list">${selected.map(item=>{const product=wine(item.wineId);return `<div class="card visit-wine-row"><div class="list-card-main"><strong>${esc(product?.name||'Wine')}</strong><span>${esc(product?.brand||'')}</span></div><select class="field compact-field" data-visit-wine-outcome="${item.wineId}" aria-label="Outcome for ${esc(product?.name||'wine')}">${VISIT_WINE_OUTCOMES.map(outcome=>`<option ${item.outcome===outcome?'selected':''}>${outcome}</option>`).join('')}</select><label class="sample-check"><input type="checkbox" data-visit-wine-sample="${item.wineId}" ${item.sampleLeft?'checked':''}><span>Sample left</span></label><button class="close-btn" data-action="remove-visit-wine" data-id="${item.wineId}" aria-label="Remove wine">${icon('x')}</button></div>`}).join('')||`<button class="card add-wine-empty" data-action="add-visit-wine">${icon('plus')} Select wines from the master list</button>`}</div>
    ${(interested.length||samples.length)?`<div class="visit-wine-summary">${interested.length?`<span><strong>Interested in</strong>${esc(interested.join(', '))}</span>`:''}${samples.length?`<span><strong>Samples left</strong>${esc(samples.join(', '))}</span>`:''}</div>`:''}
    <div class="section-row"><h2>Feedback & outcome</h2><span class="status">Required</span></div><section class="card form-card"><div class="form-group"><label>Feedback / outcome</label><select class="field" data-visit-field="feedbackOutcome">${FEEDBACK_OUTCOMES.map(outcome=>`<option ${active.feedbackOutcome===outcome?'selected':''}>${outcome}</option>`).join('')}</select></div><div class="form-group"><label>Next action</label><input class="field" data-visit-field="nextAction" maxlength="1000" value="${esc(active.nextAction||'')}" placeholder="Example: Send updated pricing"></div></section>
    <div class="section-row"><h2>Visit note</h2><span class="status">${localSaveFailed?'Not saved':'Saved on device'}</span></div><section class="card note-box"><button class="voice-button" id="voice-button" data-action="voice" aria-label="Record voice note">${icon('mic','icon-lg')}</button><p class="voice-help" id="voice-help">Tap to add speech to your note. Tap again to stop.</p><label for="visit-note">What happened?</label><textarea class="field" id="visit-note" maxlength="4000" placeholder="Example: The buyer sampled the Chardonnay and is considering a listing. Follow up Friday…">${esc(active.note||'')}</textarea>${voiceUndo?.id===active.id?'<button class="text-btn" data-action="voice-undo">Undo last voice addition</button>':''}${active.note ? structuredPreview(structured) : ''}<button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="structure-note">${icon('spark')} Structure my note</button></section>
    <div class="section-row"><h2>1. Follow-up reminder</h2></div><section class="card form-card"><div class="form-group"><label>Follow-up required?</label><select class="field" data-visit-field="followUpRequired"><option value="false" ${!active.followUpRequired?'selected':''}>No</option><option value="true" ${active.followUpRequired?'selected':''}>Yes</option></select></div>${active.followUpRequired?`<div class="form-grid"><div class="form-group"><label>Follow-up date *</label><input class="field" type="date" data-visit-field="followUpAt" value="${dateInput(active.followUpAt)}"></div><div class="form-group"><label>Person to contact</label><input class="field" data-visit-field="followUpContact" maxlength="120" value="${esc(active.followUpContact||contact.person||'')}"></div></div><div class="form-group"><label>Reason for follow-up *</label><input class="field" data-visit-field="followUpReason" maxlength="1000" value="${esc(active.followUpReason||'')}" placeholder="Example: Confirm tasting feedback"></div>`:''}</section>
    <details class="card visit-cycle-details"><summary>2. Menu / listing cycle — review or change</summary><section class="form-card"><p class="modal-hint">Record this even when they are not doing listings now. FieldFlow will nudge you before the opportunity reopens.</p><div class="form-grid"><div class="form-group"><label>Menu / wine-list change date</label><input class="field" type="date" data-visit-field="menuChangeDate" value="${dateInput(active.menuChangeDate)}"></div><div class="form-group"><label>Or known month</label><input class="field" type="month" data-visit-field="menuChangeMonth" value="${esc(active.menuChangeMonth||'')}"></div></div><div class="form-grid"><div class="form-group"><label>Listings reopen date</label><input class="field" type="date" data-visit-field="listingsReopenAt" value="${dateInput(active.listingsReopenAt)}"></div><div class="form-group"><label>Or reopen month</label><input class="field" type="month" data-visit-field="listingsReopenMonth" value="${esc(active.listingsReopenMonth||'')}"></div></div><div class="form-group"><label>Remind me beforehand</label><select class="field" data-visit-field="listingReminderDays">${LISTING_REMINDER_DAYS.map(days=>`<option value="${days}" ${Number(active.listingReminderDays||60)===days?'selected':''}>${days} days</option>`).join('')}</select></div></section></details>
    <button class="btn btn-primary btn-block sticky-save" style="margin-top:14px" data-action="end-visit">${icon('check')} End visit & save</button>
  </main>${nav()}`;
}

function structuredPreview(s) {
  return `<div class="structured"><div class="structured-item"><span>Summary</span><strong>${esc(s.summary)}</strong></div><div class="structured-item"><span>Wines detected</span><strong>${esc(s.products.join(', ')||'None detected — use Add wine')}</strong></div><div class="structured-item"><span>Next action</span><strong>${esc(s.nextAction||'No action detected')}</strong></div><div class="structured-item"><span>Follow-up</span><strong>${esc(s.followUpLabel||'No date detected')}</strong></div></div>`;
}

function structureNote(note) {
  const clean = note.trim().replace(/\s+/g,' ');
  const lower = clean.toLowerCase();
  const products = data.products.filter(p=>lower.includes(p.name.toLowerCase())).map(p=>p.name);
  const sentences = clean.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
  const action = sentences.find(s=>/send|call|email|drop|confirm|book|prepare|build|follow up/i.test(s)) || '';
  let followUp = null, followUpLabel = '';
  if (/tomorrow/i.test(clean)) { followUp=iso(1,9); followUpLabel=`Tomorrow at 09:00`; }
  else if (/next week/i.test(clean)) { followUp=iso(7,9); followUpLabel=`${dayLabel(followUp)} at 09:00`; }
  else if (/friday/i.test(clean)) { const d=new Date(); d.setDate(d.getDate()+((5-d.getDay()+7)%7||7)); d.setHours(9,0,0,0); followUp=d.toISOString(); followUpLabel=`Friday at 09:00`; }
  const outcomeSentence = sentences.find(s=>/agreed|interested|requested|confirmed|declined|trial|order|listing/i.test(s));
  const feedbackOutcome = /not doing listings|no current listing opportunity|listings? (?:are )?(?:closed|not open)/i.test(clean)
    ? 'Not doing listings now / No current listing opportunity'
    : /not interested|declined/i.test(clean) ? 'Not interested'
    : /listed|placement confirmed/i.test(clean) ? 'Listed / placement confirmed'
    : /sampled|tasted/i.test(clean) ? 'Sampled — follow-up needed'
    : /considering/i.test(clean) ? 'Considering'
    : /interested/i.test(clean) ? 'Positive — interested'
    : /trial|order agreed/i.test(clean) ? 'Order / trial agreed'
    : 'General relationship visit';
  return { summary: sentences.slice(0,2).join('. ') || 'Visit completed', products, nextAction: action, followUp, followUpLabel, outcome: outcomeSentence ? outcomeSentence.slice(0,70) : 'Visit completed', feedbackOutcome };
}

function customerDetail(id) {
  const c=customer(id); if (!c) return;
  const visits=data.visits.filter(v=>v.customerId===id).sort((a,b)=>new Date(b.start)-new Date(a.start));
  const followUps=data.tasks.filter(t=>t.customerId===id).sort((a,b)=>Number(a.done)-Number(b.done)||new Date(a.due)-new Date(b.due));
  const relations=winesForCustomer(id).sort((a,b)=>(a.status==='Listed'?-1:0)-(b.status==='Listed'?-1:0)||new Date(b.updatedAt)-new Date(a.updatedAt));
  const cycleTarget=listingCycleTarget(c); const cycleReminder=cycleReminderFor(id);
  const relationshipRows=relations.map(relation=>{const product=wine(relation.wineId);return `<div class="card wine-relation ${relationshipTone(relation.status)}"><button class="relation-main" data-action="edit-customer-wine" data-id="${relation.id}"><strong>${esc(product?.name||'Wine')}</strong><span class="status ${relationshipTone(relation.status)}">${esc(relation.status)}</span><small>${relation.status==='Listed'&&relation.listingDate?`Listed ${shortDate(relation.listingDate)}`:relation.followUpAt?`Follow up ${dayLabel(relation.followUpAt)}`:'Updated '+shortDate(relation.updatedAt)}</small>${relation.allocation?`<small>Allocation: ${esc(relation.allocation)}</small>`:''}</button><div class="relation-actions">${relation.status!=='Listed'?`<button class="mini-btn positive" data-action="set-wine-status" data-id="${relation.id}" data-status="Listed">Mark listed</button>`:''}${relation.status==='Listed'?`<button class="mini-btn" data-action="set-wine-status" data-id="${relation.id}" data-status="Delisted">Delist</button>`:''}<button class="mini-btn" data-action="wine-follow-up" data-id="${relation.id}">Follow-up</button></div></div>`}).join('');
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(c.name)} details">
    <div class="handle"></div><div class="modal-head"><span></span><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div>
    <div class="card detail-banner"><span class="status good">${esc(c.type)}</span><h2>${esc(c.name)}</h2><p>${esc(c.area||'Area not added')} · ${c.lastVisit?`last visit ${dayLabel(c.lastVisit)}`:'never visited'}</p><div class="detail-actions"><button class="btn btn-primary" data-action="start-visit" data-id="${c.id}">${icon('plus')} Start visit</button><button class="btn btn-white" data-action="edit-customer" data-id="${c.id}">Edit details</button><a class="btn btn-white" style="text-decoration:none" href="mailto:${encodeURIComponent(c.email)}">${icon('mail')} Email</a><button class="btn btn-white" data-action="set-customer-location" data-id="${c.id}">${icon('pin')} Save this location</button></div></div>
    <div class="section-row"><h2>Contact</h2></div><div class="card info-card"><h3>${esc(c.contact||'No contact added')}</h3><p style="margin:-6px 0 12px;color:var(--muted)">${esc(c.role||'Role not added')}</p><div class="info-line"><span>Email</span><strong>${esc(c.email||'Not added')}</strong></div><div class="info-line"><span>Phone</span><strong>${esc(c.phone||'Not added')}</strong></div>${c.address?`<div class="info-line"><span>Address</span><strong>${esc(c.address)}</strong></div>`:''}</div>
    <div class="section-row"><h2>Saved location</h2></div><div class="card info-card">${hasCustomerLocation(c)?`<div class="info-line" style="border:0;padding-top:0"><span>Latitude</span><strong>${c.lat.toFixed(5)}</strong></div><div class="info-line"><span>Longitude</span><strong>${c.lng.toFixed(5)}</strong></div>`:`<p style="margin:0 0 14px;color:var(--muted);font-size:13px">No venue position saved yet. Pin it while you are at the client.</p>`}<button class="btn btn-secondary btn-block btn-small" data-action="set-customer-location" data-id="${c.id}">${icon('pin')} ${hasCustomerLocation(c)?'Update':'Save'} from this device</button></div>
    <div class="section-row"><h2>Opportunity</h2></div><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>${esc(c.opportunity)}</span><strong>${currency(c.value)}</strong></div></div>
    <div class="section-row"><h2>Menu / listing cycle</h2><button class="text-btn" data-action="edit-customer" data-id="${c.id}">Edit cycle</button></div><div class="card info-card cycle-summary">${cycleTarget?`<div class="info-line" style="border:0;padding-top:0"><span>Next buying window</span><strong>${shortDate(cycleTarget)}</strong></div><div class="info-line"><span>Reminder</span><strong>${c.listingReminderDays||60} days before</strong></div>${cycleReminder?`<div class="info-line"><span>Status</span><strong class="cycle-${cycleReminder.state}">${cycleStateLabel(cycleReminder.state)}</strong></div>`:''}${c.listingCycleNotes?`<p class="muted-copy">${esc(c.listingCycleNotes)}</p>`:''}`:`<p class="muted-copy">No menu or wine-list change date saved. Add one so FieldFlow can prompt you before the next buying window.</p>`}</div>
    <div class="section-row"><h2>Wines</h2><button class="text-btn" data-action="add-customer-wine" data-id="${c.id}">${icon('plus')} Add wine</button></div><div class="listing-summary"><span class="status listed">${relations.filter(item=>item.status==='Listed').length} listed</span><span class="status pipeline">${relations.filter(item=>PIPELINE_STATUSES.includes(item.status)).length} pipeline</span></div><div class="list">${relationshipRows||emptyState('box','No wines linked','Add a wine once it is discussed, sampled or listed.')}</div>
    <div class="section-row"><h2>Follow-up reminders</h2><button class="text-btn" data-action="add-customer-task" data-id="${c.id}">${icon('plus')} Add</button></div><div class="list">${followUps.slice(0,4).map(taskCard).join('')||emptyState('check','No follow-ups','Add a dated reason and person to contact.')}</div>
    <div class="section-row"><h2>Recent visits</h2></div><div class="list">${visits.slice(0,3).map(v=>`<button class="card list-card relation-link" data-action="visit-detail" data-id="${v.id}"><div class="dot-icon">${icon('clock')}</div><div class="list-card-main"><h3>${dayLabel(v.start)} · ${duration(v.start,v.end)}</h3><p>${esc(v.feedbackOutcome||v.summary)}</p></div>${icon('arrow')}</button>`).join('')||emptyState('clock','No visits yet','Start a visit to build the history.')}</div>
  </section></div>`;
  render();
}

function productDetail(id) {
  const product=wine(id); if(!product)return;
  const relations=customersForWine(id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  const listed=relations.filter(item=>item.status==='Listed');
  const pipeline=relations.filter(item=>PIPELINE_STATUSES.includes(item.status)||item.status==='Discussed');
  const relationList=items=>items.map(relation=>{const c=customer(relation.customerId);return `<button class="card list-card relation-link" data-action="customer" data-id="${c?.id}"><div class="dot-icon">${initials(c?.name||'?')}</div><div class="list-card-main"><h3>${esc(c?.name||'Client')}</h3><p>${esc(c?.area||'')} · ${esc(relation.status)}${relation.allocation?` · ${esc(relation.allocation)}`:''}</p></div>${icon('arrow')}</button>`}).join('');
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(product.name)} details"><div class="handle"></div><div class="modal-head"><h2>${esc(product.name)}</h2><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>Producer</span><strong>${esc(product.brand)}</strong></div><div class="info-line"><span>Range / variety</span><strong>${esc(product.range||'—')}</strong></div><div class="info-line"><span>Pack</span><strong>${esc(product.pack)}</strong></div><div class="info-line"><span>Case incl. VAT</span><strong>${currency(product.price)}</strong></div></div><button class="btn btn-primary btn-block" style="margin-top:12px" data-action="assign-product" data-id="${product.id}">${icon('plus')} Add restaurant</button><div class="section-row"><h2>Currently listed at</h2><span class="status listed">${listed.length}</span></div><div class="list">${relationList(listed)||emptyState('check','No active listings','Only status Listed appears here.')}</div><div class="section-row"><h2>Pipeline / interest</h2><span class="status pipeline">${pipeline.length}</span></div><div class="list">${relationList(pipeline)||emptyState('clock','No active pipeline','Interested, sampled and considering restaurants appear here.')}</div>${relations.filter(item=>item.status==='Delisted').length?`<div class="section-row"><h2>Past listings</h2></div><div class="list">${relationList(relations.filter(item=>item.status==='Delisted'))}</div>`:''}</section></div>`;
  render();
}

function winePickerModal(mode, customerId = null) {
  pickerContext={mode,customerId};
  const selected = new Set(mode==='visit'?(data.activeVisit?.wineOutcomes||[]).map(item=>item.wineId):winesForCustomer(customerId).map(item=>item.wineId));
  const matches=data.products.filter(product=>product.active&&`${product.name} ${product.brand} ${product.range} ${product.sku}`.toLowerCase().includes(modalQuery.toLowerCase())).slice(0,30);
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="Choose a wine"><div class="handle"></div><div class="modal-head"><h2>Choose wine</h2><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><div class="search">${icon('search')}<input id="wine-picker-search" value="${esc(modalQuery)}" placeholder="Search wine, producer or SKU" autocomplete="off"></div><p class="modal-hint">Showing the first ${matches.length} matches. One master wine is linked—never copied.</p><div class="choice-list">${matches.map(product=>`<button class="choice ${selected.has(product.id)?'selected':''}" data-action="${mode==='visit'?'pick-visit-wine':'pick-customer-wine'}" data-id="${product.id}" ${customerId?`data-customer-id="${customerId}"`:''} ${selected.has(product.id)?'disabled':''}><div class="dot-icon">${icon('box')}</div><div><strong>${esc(product.name)}</strong><span>${esc(product.brand)} · ${esc(product.range)}</span></div></button>`).join('')||emptyState('search','No wines found','Try a product name, producer or SKU.')}</div></section></div>`;
  render();
}

function wineRelationshipModal({ relationId = null, customerId = null, wineId = null } = {}) {
  const relation=relationId?customerWine(relationId):null;
  const selectedCustomerId=relation?.customerId||customerId||data.customers[0]?.id||'';
  const selectedWineId=relation?.wineId||wineId||data.products[0]?.id||'';
  const item=relation||{status:'Interested',listingDate:null,allocation:'',followUpAt:null,notes:'',history:[]};
  if(!data.customers.length){customerFormModal();toast('Add a client before assigning a wine.');return;}
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="wine-relation-form" data-id="${relation?.id||''}"><div class="handle"></div><div class="modal-head"><h2>${relation?'Update wine':'Add wine to restaurant'}</h2><button type="button" class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><div class="form-group"><label>Restaurant</label>${relation||customerId?`<div class="readonly-field">${esc(customer(selectedCustomerId)?.name||'Client')}</div><input type="hidden" name="customerId" value="${selectedCustomerId}">`:`<select class="field" name="customerId">${data.customers.map(c=>`<option value="${c.id}" ${c.id===selectedCustomerId?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`}</div><div class="form-group"><label>Wine</label>${relation||wineId?`<div class="readonly-field">${esc(wine(selectedWineId)?.name||'Wine')}</div><input type="hidden" name="wineId" value="${selectedWineId}">`:`<select class="field" name="wineId">${data.products.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)} — ${esc(p.brand)}</option>`).join('')}</select>`}</div><div class="form-group"><label>Status</label><select class="field" name="status">${WINE_STATUSES.map(status=>`<option ${item.status===status?'selected':''}>${status}</option>`).join('')}</select><small class="field-help">Only Listed counts as a confirmed placement.</small></div><div class="form-grid"><div class="form-group"><label>Listing date</label><input class="field" type="date" name="listingDate" value="${dateInput(item.listingDate)}"></div><div class="form-group"><label>Allocation / quantity</label><input class="field" name="allocation" maxlength="160" value="${esc(item.allocation)}" placeholder="Optional"></div></div><div class="form-group"><label>Follow-up date</label><input class="field" type="date" name="followUp" value="${dateInput(item.followUpAt)}"></div><div class="form-group"><label>Notes</label><textarea class="field" name="notes" maxlength="4000" placeholder="Optional listing or allocation detail">${esc(item.notes)}</textarea></div>${relation&&item.history.length?`<details class="history"><summary>Status history (${item.history.length})</summary>${[...item.history].reverse().slice(0,12).map(event=>`<div><strong>${esc(event.status)}</strong><span>${shortDate(event.at)}${event.note?` · ${esc(event.note)}`:''}</span></div>`).join('')}</details>`:''}<button class="btn btn-primary btn-block sticky-save">Save wine status</button></form></div>`;
  render();
}

function visitDetail(id) {
  const visit=data.visits.find(item=>item.id===id); if(!visit)return;
  const c=customer(visit.customerId);
  const contact=visit.contactSnapshot||{}; const current=wineNames(visit.currentWineIds); const samples=wineNames(visit.samplesLeftWineIds);
  const interested=(visit.wineOutcomes||[]).filter(item=>['Interested','Considering'].includes(item.outcome)).map(item=>wine(item.wineId)?.name).filter(Boolean);
  const followTask=visit.followUpTaskId?data.tasks.find(item=>item.id===visit.followUpTaskId):null;
  const cycleValue=visit.listingsReopenAt||(visit.listingsReopenMonth?`${visit.listingsReopenMonth}-01T09:00:00`:null)||visit.menuChangeDate||(visit.menuChangeMonth?`${visit.menuChangeMonth}-01T09:00:00`:null);
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="Visit details"><div class="handle"></div><div class="modal-head"><h2>${esc(c?.name||'Visit')}</h2><button class="close-btn" data-action="close-modal">${icon('x')}</button></div>
    <div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>Place</span><strong>${esc(contact.placeName||c?.name||'Visit')}</strong></div><div class="info-line"><span>Date / duration</span><strong>${shortDate(visit.start)} · ${duration(visit.start,visit.end)}</strong></div><div class="info-line"><span>Address</span><strong>${esc(contact.address||c?.address||'Not recorded')}</strong></div><div class="info-line"><span>Contact</span><strong>${esc(contact.person||c?.contact||'Not recorded')}${contact.role||c?.role?` · ${esc(contact.role||c.role)}`:''}</strong></div><div class="info-line"><span>Phone / email</span><strong>${esc(contact.phone||c?.phone||'—')} · ${esc(contact.email||c?.email||'—')}</strong></div></div>
    <div class="section-row"><h2>Feedback / outcome</h2></div><div class="card info-card"><h3>${esc(visit.feedbackOutcome||visit.outcome||'Visit completed')}</h3><p class="muted-copy">${esc(visit.summary||'No feedback note recorded.')}</p><div class="info-line"><span>Next action</span><strong>${esc(visit.nextAction||'—')}</strong></div></div>
    <div class="section-row"><h2>Wine activity</h2></div><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>Current listings</span><strong>${esc(current.join(', ')||'None recorded')}</strong></div><div class="info-line"><span>Interested in</span><strong>${esc(interested.join(', ')||'None recorded')}</strong></div><div class="info-line"><span>Samples left</span><strong>${esc(samples.join(', ')||'None recorded')}</strong></div></div><div class="list">${(visit.wineOutcomes||[]).map(item=>`<div class="card list-card"><div class="dot-icon">${icon('box')}</div><div class="list-card-main"><h3>${esc(wine(item.wineId)?.name||'Wine')}</h3><p>${esc(item.outcome)}${item.sampleLeft?' · Sample left':''}</p></div></div>`).join('')||emptyState('box','No wines selected','Older visits may only have note-based product names.')}</div>
    <div class="section-row"><h2>Follow-up reminder</h2></div><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>Required</span><strong>${visit.followUpRequired?'Yes':'No'}</strong></div>${visit.followUpRequired?`<div class="info-line"><span>Date</span><strong>${dayLabel(followTask?.due||visit.followUp)}</strong></div><div class="info-line"><span>Reason</span><strong>${esc(followTask?.reason||visit.followUpReason||'—')}</strong></div><div class="info-line"><span>Person</span><strong>${esc(followTask?.contactPerson||visit.followUpContact||'—')}</strong></div><div class="info-line"><span>Completed</span><strong>${followTask?.done||visit.followUpCompleted?'Yes':'No'}</strong></div>${followTask?`<button class="btn btn-secondary btn-block btn-small" data-action="edit-task" data-id="${followTask.id}">Reschedule or edit</button>`:''}`:''}</div>
    <div class="section-row"><h2>Menu / listing cycle</h2></div><div class="card info-card">${cycleValue?`<div class="info-line" style="border:0;padding-top:0"><span>Next window</span><strong>${shortDate(cycleValue)}</strong></div><div class="info-line"><span>Reminder</span><strong>${visit.listingReminderDays||60} days before</strong></div>`:`<p class="muted-copy">No listing-cycle date recorded during this visit.</p>`}</div>
    <details class="card visit-details"><summary>Full original note</summary><p class="full-note">${esc(visit.rawNote??visit.summary??'No note recorded.')}</p>${visit.rawNote==null?'<p class="modal-hint">This older visit only retained its summary.</p>':''}</details><button class="btn btn-secondary btn-block" data-action="edit-visit" data-id="${visit.id}">Edit notes & outcome</button><button class="btn btn-ghost btn-block destructive-link" style="margin-top:14px" data-action="delete-visit" data-id="${visit.id}">Delete this visit</button></section></div>`;
  render();
}

function startVisitModal(prefill) {
  if (data.activeVisit) { screen='visit'; modal=null; return render(); }
  if (!data.customers.length) { customerFormModal(); toast('Add your first client before starting a visit.'); return; }
  let selected=prefill||(data.travel.lastPosition?nearestCustomer(data.travel.lastPosition)?.customer.id:null)||data.customers[0]?.id;
  const paint = (locationText='Location will be captured when you start') => {
    modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="Start a visit"><div class="handle"></div><div class="modal-head"><h2>Start visit</h2><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><p style="color:var(--muted);margin:-7px 0 15px">Choose where you are. We’ll handle the rest.</p><div class="choice-list">${data.customers.map(c=>{const km=data.travel.lastPosition?geoDistanceKm(data.travel.lastPosition,{lat:c.lat,lng:c.lng}):null;return `<button class="choice ${selected===c.id?'selected':''}" data-action="select-visit-customer" data-id="${c.id}"><div class="dot-icon">${initials(c.name)}</div><div><strong>${esc(c.name)}</strong><span>${esc(c.area)} · ${km!=null?`${km<1?`${Math.round(km*1000)} m`:`${km.toFixed(1)} km`} away`:esc(c.contact)}</span></div></button>`}).join('')}</div><div class="location-state">${icon('pin')}<span>${esc(locationText)}</span></div><button class="btn btn-primary btn-block" data-action="confirm-start" data-id="${selected}">${icon('plus')} Start visit now</button></section></div>`; render();
  };
  paint();
}

function taskModal(taskId = null, prefill = {}) {
  if (!data.customers.length) { customerFormModal(); toast('Add a client before creating a follow-up.'); return; }
  const existing=taskId?data.tasks.find(item=>item.id===taskId):null;
  const item=existing||{customerId:prefill.customerId||data.customers[0].id,wineId:prefill.wineId||null,title:prefill.title||'',due:prefill.due||iso(1,9),reason:prefill.reason||'',contactPerson:prefill.contactPerson||customer(prefill.customerId||data.customers[0].id)?.contact||'',done:false,rescheduleHistory:[]};
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="task-form" data-id="${existing?.id||''}"><div class="handle"></div><div class="modal-head"><h2>${existing?'Edit / reschedule':'New'} follow-up</h2><button type="button" class="close-btn" data-action="close-modal">${icon('x')}</button></div><div class="location-state">${icon('check')}<span>This is a normal follow-up reminder. Menu/listing-cycle reminders are managed separately on the venue.</span></div><div class="form-group"><label>Customer</label><select class="field" name="customerId">${data.customers.map(c=>`<option value="${c.id}" ${item.customerId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="form-group"><label>Wine (optional)</label><select class="field" name="wineId"><option value="">General follow-up</option>${data.products.filter(p=>p.active).map(product=>`<option value="${product.id}" ${item.wineId===product.id?'selected':''}>${esc(product.name)}</option>`).join('')}</select></div><div class="form-group"><label>Next action *</label><input class="field" name="title" maxlength="1000" required value="${esc(item.title)}" placeholder="Call buyer about trial order"></div><div class="form-group"><label>Reason for follow-up *</label><input class="field" name="reason" maxlength="1000" required value="${esc(item.reason||item.title)}" placeholder="Confirm tasting feedback"></div><div class="form-grid"><div class="form-group"><label>Person to contact</label><input class="field" name="contactPerson" maxlength="120" value="${esc(item.contactPerson||'')}"></div><div class="form-group"><label>Follow-up date *</label><input class="field" name="due" type="date" required value="${dateInput(item.due)}"></div></div><div class="form-group"><label>Follow-up completed?</label><select class="field" name="done"><option value="false" ${!item.done?'selected':''}>No</option><option value="true" ${item.done?'selected':''}>Yes</option></select></div>${existing?.rescheduleHistory?.length?`<details class="history"><summary>Reschedule history (${existing.rescheduleHistory.length})</summary>${[...existing.rescheduleHistory].reverse().map(change=>`<div><strong>${dayLabel(change.from)} → ${dayLabel(change.to)}</strong><span>Changed ${shortDate(change.at)}</span></div>`).join('')}</details>`:''}<button class="btn btn-primary btn-block">Save follow-up</button>${existing?`<button type="button" class="btn btn-ghost btn-block destructive-link" style="margin-top:8px" data-action="delete-task" data-id="${existing.id}">Delete follow-up</button>`:''}</form></div>`; render();
}

function tripFormModal(tripId = null) {
  const existing=tripId?data.travel.trips.find(item=>item.id===tripId):null;
  const last=[...data.travel.trips].sort((a,b)=>new Date(b.end)-new Date(a.end))[0];
  const start=currentDate(); const end=new Date(start.getTime()+60000);
  const item=existing||{start:start.toISOString(),end:end.toISOString(),fromLabel:customer(last?.toCustomerId)?.name||last?.toLabel||'',toLabel:'',customerId:'',purpose:'Customer visit',startOdometer:null,endOdometer:null,distanceKm:0,notes:'',distanceSource:'manual'};
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="trip-form" data-id="${existing?.id||''}"><div class="handle"></div><div class="modal-head"><h2>${existing?'Edit':'Add'} business trip</h2><button type="button" class="close-btn" data-action="close-modal">${icon('x')}</button></div><p class="modal-hint">Use odometer readings when available. Otherwise enter the business kilometres once.</p><div class="form-grid"><div class="form-group"><label>Date</label><input class="field" type="date" name="date" required value="${dateInput(item.start)}"></div><div class="form-group"><label>Start time</label><input class="field" type="time" name="time" required value="${new Date(item.start).toTimeString().slice(0,5)}"></div></div><div class="form-grid"><div class="form-group"><label>From</label><input class="field" name="fromLabel" maxlength="500" required value="${esc(customer(item.fromCustomerId)?.name||item.fromLabel||'')}" placeholder="Starting location"></div><div class="form-group"><label>To</label><input class="field" name="toLabel" maxlength="500" value="${esc(customer(item.toCustomerId)?.name||item.toLabel||'')}" placeholder="Destination"></div></div><div class="form-group"><label>Restaurant / account</label><select class="field" name="customerId"><option value="">No account</option>${data.customers.map(c=>`<option value="${c.id}" ${item.customerId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="form-group"><label>Business purpose *</label><input class="field" name="purpose" maxlength="500" required value="${esc(item.purpose||'Customer visit')}" placeholder="Customer visit"></div><div class="form-grid"><div class="form-group"><label>Start odometer</label><input class="field" type="number" name="startOdometer" min="0" max="10000000" step="0.1" value="${item.startOdometer??''}" placeholder="Optional"></div><div class="form-group"><label>End odometer</label><input class="field" type="number" name="endOdometer" min="0" max="10000000" step="0.1" value="${item.endOdometer??''}" placeholder="Optional"></div></div><div class="form-group"><label>KM (used when odometer is blank)</label><input class="field" type="number" name="distanceKm" min="0" max="100000" step="0.1" value="${Number(item.distanceKm)||''}" placeholder="0.0"></div><div class="form-group"><label>Notes</label><textarea class="field" name="notes" maxlength="4000" placeholder="Optional evidence or explanation">${esc(item.notes||'')}</textarea></div><button class="btn btn-primary btn-block sticky-save">Save trip</button>${existing?`<button type="button" class="btn btn-ghost btn-block destructive-link" style="margin-top:8px" data-action="delete-trip" data-id="${existing.id}">Delete trip</button>`:''}</form></div>`;
  render();
}

function customerFormModal(customerId = null) {
  const existing = customerId ? customer(customerId) : null;
  const item = existing || { name:'', type:'Restaurant', area:'', address:'', contact:'', role:'', email:'', phone:'', opportunity:'', value:0, lat:null, lng:null, menuChangeDate:null, menuChangeMonth:'', listingsReopenAt:null, listingsReopenMonth:'', listingReminderDays:60, listingCycleNotes:'' };
  const types = ['Restaurant','Café','Bar','Retail','Hotel','Distributor','Other'];
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="customer-form" data-id="${existing?.id||''}">
    <div class="handle"></div><div class="modal-head"><h2>${existing?'Edit client':'Add new client'}</h2><button type="button" class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div>
    <p style="color:var(--muted);margin:-7px 0 18px">${existing?'Update the client and contact information.':'Add the basics now. You can pin the exact venue location when you arrive.'}</p>
    <div class="form-group"><label>Client or venue name *</label><input class="field" name="name" maxlength="120" required value="${esc(item.name)}" placeholder="Example: Riverside Bistro"></div>
    <div class="form-grid"><div class="form-group"><label>Client type</label><select class="field" name="type">${types.map(type=>`<option ${item.type===type?'selected':''}>${type}</option>`).join('')}</select></div><div class="form-group"><label>Area</label><input class="field" name="area" maxlength="120" value="${esc(item.area)}" placeholder="Rosebank"></div></div>
    <div class="form-group"><label>Street address</label><input class="field" name="address" maxlength="500" value="${esc(item.address||'')}" placeholder="Street and suburb"></div>
    <div class="section-row"><h2>Primary contact</h2></div>
    <div class="form-grid"><div class="form-group"><label>Contact name</label><input class="field" name="contact" maxlength="120" value="${esc(item.contact)}" placeholder="Full name"></div><div class="form-group"><label>Role</label><input class="field" name="role" maxlength="60" value="${esc(item.role)}" placeholder="Buyer"></div></div>
    <div class="form-group"><label>Email</label><input class="field" name="email" type="email" maxlength="254" value="${esc(item.email)}" placeholder="buyer@client.co.za"></div>
    <div class="form-group"><label>Phone</label><input class="field" name="phone" type="tel" maxlength="40" value="${esc(item.phone)}" placeholder="+27 …"></div>
    <div class="section-row"><h2>Sales opportunity</h2></div>
    <div class="form-grid"><div class="form-group"><label>Opportunity</label><input class="field" name="opportunity" maxlength="1000" value="${esc(item.opportunity)}" placeholder="New listing"></div><div class="form-group"><label>Estimated value</label><input class="field" name="value" type="number" min="0" max="1000000000000" step="100" value="${Number(item.value)||0}"></div></div>
    <div class="section-row"><h2>Menu / listing cycle</h2></div><p class="modal-hint">Use the most exact information you have. A reopen date takes priority; otherwise use the menu change date or month.</p>
    <div class="form-grid"><div class="form-group"><label>Menu / wine-list change date</label><input class="field" name="menuChangeDate" type="date" value="${dateInput(item.menuChangeDate)}"></div><div class="form-group"><label>Or known month</label><input class="field" name="menuChangeMonth" type="month" value="${esc(item.menuChangeMonth||'')}"></div></div>
    <div class="form-grid"><div class="form-group"><label>Listings reopen date</label><input class="field" name="listingsReopenAt" type="date" value="${dateInput(item.listingsReopenAt)}"></div><div class="form-group"><label>Or reopen month</label><input class="field" name="listingsReopenMonth" type="month" value="${esc(item.listingsReopenMonth||'')}"></div></div><div class="form-group"><label>Remind me beforehand</label><select class="field" name="listingReminderDays">${LISTING_REMINDER_DAYS.map(days=>`<option value="${days}" ${Number(item.listingReminderDays||60)===days?'selected':''}>${days} days</option>`).join('')}</select></div>
    <div class="form-group"><label>Listing-cycle notes</label><textarea class="field" name="listingCycleNotes" maxlength="2000" placeholder="Example: Buyer reviews the list with the owner in November">${esc(item.listingCycleNotes||'')}</textarea></div>
    <label class="location-option"><input type="checkbox" name="useCurrentLocation"><span>${icon('pin')}<span><strong>${existing&&hasCustomerLocation(existing)?'Replace saved location':'Pin current device location'}</strong><small>${data.travel.lastPosition?'Use the most recently captured device position':'Use “Save this location” from the client profile when on site'}</small></span></span></label>
    <button class="btn btn-primary btn-block" type="submit">${existing?'Save changes':'Add client'}</button>
  </form></div>`;
  render();
}

async function cloudDifferencesModal(){
  const differences=await reviewCloudDifferences();
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal"><div class="modal-head"><h2>Review sync differences</h2><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><p class="modal-hint">Neither copy has been discarded. Choose one record at a time. A backup downloads before each choice; when finished, use Sync now.</p>${differences.map(item=>`<section class="card info-card"><h3>${esc(item.title)}</h3><details><summary>Compare record details</summary><h4>This device</h4><pre class="full-note">${esc(JSON.stringify(item.local,null,2))}</pre><h4>Cloud</h4><pre class="full-note">${esc(JSON.stringify(item.cloud,null,2))}</pre></details><div class="form-grid"><button class="btn btn-secondary" data-action="cloud-choose" data-token="${esc(item.token)}" data-choice="device">Keep device copy</button><button class="btn btn-secondary" data-action="cloud-choose" data-token="${esc(item.token)}" data-choice="cloud">Use cloud copy</button></div></section>`).join('')||'<p>No competing edits found. Sync now to load new cloud records, or check the sync error in Profile & backup.</p>'}<button class="btn btn-primary btn-block" data-action="cloud-sync">Sync now</button></section></div>`;render();
}
function settingsModal() {
  const syncText = cloudState.error ? `Needs attention: ${cloudState.error}` : cloudState.syncing ? 'Syncing now…' : cloudState.lastSynced ? `Last synced ${time(cloudState.lastSynced)}` : 'Ready to sync';
  const installPanel = appInstalled ? `<div class="location-state">${icon('check')}<span>FieldFlow is installed on this device.</span></div>` : `<div class="card info-card"><h3>Install on this phone</h3><p style="margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5">${isSamsungInternet?'For this Samsung, install through Chrome to avoid the outdated package warning.':'Add FieldFlow to your Apps screen for full-screen access and safer offline use.'}</p><button class="btn btn-primary btn-block" data-action="install-app">${icon('download')} ${isSamsungInternet?'Open safely in Chrome':deferredInstallPrompt?'Install FieldFlow':'Show installation steps'}</button></div>`;
  const cloudPanel = !cloudState.configured
    ? `<div class="card info-card"><h3>Cloud backup</h3><p style="margin:0;color:var(--muted);font-size:13px;line-height:1.5">Cloud connection is not configured on this device. Local capture still works.</p></div>`
    : cloudState.signedIn
      ? `<div class="card info-card"><h3>Cloud backup is on</h3><div class="info-line"><span>Signed in as</span><strong>${esc(cloudState.email)}</strong></div><div class="info-line"><span>Status</span><strong>${esc(syncText)}</strong></div><div class="form-grid" style="margin-top:12px"><button class="btn btn-secondary" data-action="cloud-sync">Sync now</button><button class="btn btn-ghost" data-action="cloud-signout">Sign out</button></div>${cloudState.error?`<button class="btn btn-secondary btn-block" data-action="cloud-review">Review sync differences</button>`:''}<div></div></div>`
      : `<form class="card info-card" id="auth-form"><h3>Back up and sync</h3><p style="margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5">Pilot access is invitation-only. Sign in with the account created for you to keep customers, visits, follow-ups, products and mileage safely synced.</p><div class="form-group"><label>Email</label><input class="field" name="email" type="email" autocomplete="email" required maxlength="320" placeholder="you@example.com"></div><div class="form-group"><label>Password</label><input class="field" name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="Your password"></div><button class="btn btn-primary btn-block" type="submit">Sign in</button>${cloudState.error?`<p class="form-error">${esc(cloudState.error)}</p>`:''}</form>`;
  modal=`<div class="modal-backdrop" data-modal="settings" data-action="close-modal"><section class="modal"><div class="handle"></div><div class="modal-head"><h2>Profile & backup</h2><button class="close-btn" data-action="close-modal">${icon('x')}</button></div>${installPanel}<div class="card info-card"><h3>${esc(data.profile.name)}</h3><div class="info-line"><span>Territory</span><strong>${esc(data.profile.territory)}</strong></div><div class="info-line"><span>Local storage</span><strong>${localSaveFailed?'Needs attention':'Available on this device'}</strong></div><div class="info-line"><span>KM rate</span><strong>${currency(data.travel.ratePerKm)}/km</strong></div></div>${cloudPanel}<div class="card info-card"><h3>Device backup</h3><p class="muted-copy">Download a complete copy before changing phones or clearing browser data.</p><div class="form-grid"><button class="btn btn-secondary" data-action="export-backup">${icon('download')} Export</button><button class="btn btn-ghost" data-action="import-backup">Import</button></div><input id="backup-file" type="file" accept="application/json,.json" hidden></div><p style="color:var(--muted);font-size:13px;line-height:1.5">Field work saves to this device first. When signed in, it syncs securely as soon as a connection is available.</p><button class="btn btn-ghost btn-block destructive-link" data-action="clear-crm-data">${icon('refresh')} Clear my CRM data</button></section></div>`; render();
}

function installHelpModal() {
  if (isSamsungInternet) {
    modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="Install FieldFlow safely"><div class="handle"></div><div class="modal-head"><h2>Install safely</h2><button class="close-btn" data-action="close-modal">${icon('x')}</button></div><div class="install-guide-mark">${icon('download','icon-lg')}</div><h3 style="font-size:20px;margin:0 0 8px">Use Google Chrome</h3><p style="color:var(--muted);line-height:1.5;margin:0 0 18px">Samsung Internet generated the older Android package shown in the Play Protect warning. Do not choose “Install anyway”. Open the same secure FieldFlow site in Chrome and install it there.</p><button class="btn btn-primary btn-block" data-action="open-in-chrome">Open FieldFlow in Chrome</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-action="close-modal">Not now</button></section></div>`;
    render();
    return;
  }
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="Install FieldFlow"><div class="handle"></div><div class="modal-head"><h2>Install FieldFlow</h2><button class="close-btn" data-action="close-modal">${icon('x')}</button></div><div class="install-guide-mark">${icon('download','icon-lg')}</div><h3 style="font-size:20px;margin:0 0 8px">Use it like a normal app</h3><p style="color:var(--muted);line-height:1.5;margin:0 0 18px">In Chrome, tap the three-dot menu (⋮), then choose Install app or Add to Home screen.</p><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>1</span><strong>Open the Chrome menu</strong></div><div class="info-line"><span>2</span><strong>Choose Install app</strong></div><div class="info-line"><span>3</span><strong>Tap Install to confirm</strong></div></div><button class="btn btn-primary btn-block" data-action="close-modal">Got it</button></section></div>`;
  render();
}

function emptyState(ic,title,text){return `<div class="card empty"><div class="dot-icon">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;}

function render() {
  stopVoiceCapture();
  const cycleOpen=document.querySelector('.visit-cycle-details')?.open;
  clearInterval(timerId);
  clearInterval(travelTimerId);
  const views={home:homeView,customers:customersView,activity:activityView,travel:travelView,products:productsView,reports:reportsView,assistant:assistantView,visit:visitView};
  document.getElementById('app').innerHTML=(views[screen]||homeView)()+(modal||'');
  if(cycleOpen&&document.querySelector('.visit-cycle-details'))document.querySelector('.visit-cycle-details').open=true;
  if (data.activeVisit) timerId=setInterval(()=>document.querySelectorAll('[data-timer]').forEach(el=>el.textContent=duration(data.activeVisit.start)),1000);
  if (data.travel.activeTrip) {
    travelTimerId=setInterval(()=>document.querySelectorAll('[data-travel-timer]').forEach(el=>el.textContent=duration(data.travel.activeTrip.start)),1000);
    resumeTravelTracking();
  }
  if(screen==='assistant') setTimeout(()=>document.getElementById('chat')?.lastElementChild?.scrollIntoView({behavior:'smooth'}),50);
}

function answerQuestion(q) {
  const lower=q.toLowerCase(); const pending=data.tasks.filter(t=>!t.done).sort((a,b)=>new Date(a.due)-new Date(b.due));const windows=cycleReminders(),priorityWindows=windows.filter(item=>item.state!=='upcoming');
  if (/mileage|kilomet|travel|reimburse|claim/.test(lower)) { const weekTrips=data.travel.trips.filter(t=>new Date(t.start)>new Date(Date.now()-7*DAY));const km=weekTrips.reduce((sum,t)=>sum+Number(t.distanceKm||0),0),claim=weekTrips.reduce((sum,t)=>sum+Number(t.reimbursement||0),0);return `Your last 7 days total ${km.toFixed(1)} km across ${weekTrips.length} trips. The saved reimbursement is ${currency(claim)}.`; }
  if (/menu|listing window|buying window|reopen/.test(lower)) { const first=priorityWindows[0]||windows[0];return first?`${priorityWindows.length} venues are in or approaching a listing window. Start with ${customer(first.customerId)?.name}; its target is ${dayLabel(first.targetAt)} and the reminder is set for ${first.leadDays} days beforehand.`:'No listing windows are scheduled yet. Add a menu-change month or listings-reopen date to a venue.'; }
  if (/follow.?up|due|overdue/.test(lower)) { const first=pending[0],product=wine(first?.wineId);return pending.length ? `You have ${pending.length} open follow-ups. Start with ${customer(first.customerId)?.name}${product?` about ${product.name}`:''}: ${first.title.toLowerCase()} (${dayLabel(first.due)}).` : 'You have no open follow-ups.'; }
  if (/not visited|recently|neglect/.test(lower)) { const sorted=[...data.customers].sort((a,b)=>new Date(a.lastVisit)-new Date(b.lastVisit)); if(!sorted.length)return 'Add your first client and I will track who has not been visited.'; return sorted.length===1?`${sorted[0].name} has ${sorted[0].lastVisit?`not been visited since ${dayLabel(sorted[0].lastVisit)}`:'not been visited yet'}.`:`${sorted[0].name} needs a visit most — last seen ${dayLabel(sorted[0].lastVisit)}. ${sorted[1].name} is next.`; }
  if (/today|prioriti|plan|do next/.test(lower)) { if(!data.customers.length)return 'Start by adding your first client. Then I can build your daily visit and follow-up plan.';const window=priorityWindows[0];if(window)return `Today: 1) Contact ${customer(window.customerId)?.name} because its listing window is ${window.state==='open'?'open':`approaching on ${dayLabel(window.targetAt)}`}. 2) ${pending.length?`${pending[0].title} for ${customer(pending[0].customerId)?.name}`:'Visit the account not seen for the longest'}. 3) Record the outcome and next date.`;return pending.length ? `Today: 1) ${pending[0].title} for ${customer(pending[0].customerId)?.name}. 2) Visit ${[...data.customers].sort((a,b)=>new Date(a.lastVisit)-new Date(b.lastVisit))[0].name}. 3) Clear any new notes before you finish.` : 'Your follow-ups are clear. Prioritise the customer with the oldest visit date.'; }
  if (/last visit|what happened/.test(lower)) { const visit=[...data.visits].sort((a,b)=>new Date(b.start)-new Date(a.start))[0]; return visit?`Your last visit was to ${customer(visit.customerId)?.name||'a client'} on ${dayLabel(visit.start)}: ${visit.summary} Next action: ${visit.nextAction||'None recorded'}.`:'You have no recorded visits yet.'; }
  const named=data.customers.find(c=>lower.includes(c.name.toLowerCase())||lower.includes(c.name.split(' ')[0].toLowerCase()));
  if (named) { const visit=data.visits.filter(v=>v.customerId===named.id).sort((a,b)=>new Date(b.start)-new Date(a.start))[0],listings=winesForCustomer(named.id).filter(item=>item.status==='Listed').map(item=>wine(item.wineId)?.name).filter(Boolean); return visit ? `Last visit to ${named.name} was ${dayLabel(visit.start)}: ${visit.summary} Next action: ${visit.nextAction||'None recorded'}. Current listings: ${listings.join(', ')||'none recorded'}.` : `${named.name} has no recorded visits yet. Current listings: ${listings.join(', ')||'none recorded'}.`; }
  const namedWine=data.products.find(product=>lower.includes(product.name.toLowerCase()));
  if(namedWine&&/where|listed|interest|pipeline/.test(lower)){const listed=customersForWine(namedWine.id).filter(item=>item.status==='Listed').map(item=>customer(item.customerId)?.name).filter(Boolean),pipeline=customersForWine(namedWine.id).filter(item=>PIPELINE_STATUSES.includes(item.status)).map(item=>customer(item.customerId)?.name).filter(Boolean);return `${namedWine.name} is listed at ${listed.join(', ')||'no restaurants yet'}. Pipeline: ${pipeline.join(', ')||'none recorded'}.`;}
  if (/listing|listed|placement/.test(lower)) return `You have ${activeListings().length} confirmed active listings across ${new Set(activeListings().map(item=>item.customerId)).size} restaurants. Interested or sampled wines are not included.`;
  if (/product|wine|discussed|range/.test(lower)) { const counts={}; data.visits.flatMap(v=>v.wineOutcomes||[]).forEach(item=>{const name=wine(item.wineId)?.name;if(name)counts[name]=(counts[name]||0)+1;}); const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]; return top?`${top[0]} is the most discussed wine in your recorded visits (${top[1]} mentions).`:'No wine discussions are recorded yet.'; }
  return 'I can help with follow-ups, listing windows, wine pipeline, customers not visited recently, last-visit notes, mileage and today’s priorities.';
}

function ask(q) { if(!q.trim())return; data.chat.push({role:'user',text:q.trim()},{role:'ai',text:answerQuestion(q)});if(data.chat.length>500){data.chat=data.chat.slice(-500);toast('Older assistant messages were removed to keep cloud backup reliable.');}save();screen='assistant';render(); }

const toPoint = position => ({ lat:position.coords.latitude, lng:position.coords.longitude, accuracy:position.coords.accuracy, capturedAt:new Date(position.timestamp || Date.now()).toISOString() });

function captureDeviceLocation(onSuccess, onErrorMessage = 'Location permission is needed for this feature.') {
  if (!navigator.geolocation) { toast('This browser does not provide device location.'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    const point = toPoint(position);
    data.travel.lastPosition = point;
    save();
    onSuccess?.(point);
  }, () => toast(onErrorMessage), { enableHighAccuracy:true, timeout:10000, maximumAge:15000 });
}

function resumeTravelTracking() {
  if (!data.travel.activeTrip || locationWatchId !== null || !navigator.geolocation) return;
  locationWatchId = navigator.geolocation.watchPosition(position => {
    const point = toPoint(position);
    data.travel.lastPosition = point;
    const trip = data.travel.activeTrip;
    if (!trip) return;
    trip.lastAccuracy = point.accuracy;
    if (point.accuracy <= 100) {
      const previous = trip.points.at(-1);
      const minimumMovement = previous ? Math.max(0.025, ((previous.accuracy || 0) + point.accuracy) / 2000) : 0;
      if ((!previous || geoDistanceKm(previous, point) >= minimumMovement) && trip.points.length < 20000) trip.points.push(point);
      else if (trip.points.length >= 20000 && !trip.pointLimitReached) { trip.pointLimitReached=true; toast('This trip reached the GPS safety limit. Stop and start a new trip to keep recording.'); }
      if (trip.points.length === 1) {
        const nearest = nearestCustomer(point);
        if (nearest?.km <= .5) trip.fromCustomerId = nearest.customer.id;
      }
    }
    save();
    document.querySelectorAll('[data-trip-distance]').forEach(el=>el.textContent=`${currentTripKm().toFixed(1)} km`);
  }, () => toast('GPS signal was lost. Keep the app open and check location settings.'), { enableHighAccuracy:true, maximumAge:5000, timeout:15000 });
}

function startTravelTracking() {
  if (data.travel.activeTrip) { screen='travel'; resumeTravelTracking(); render(); return; }
  captureDeviceLocation(point => {
    const nearest = nearestCustomer(point);
    data.travel.activeTrip = { id:`trip${Date.now()}`, start:new Date().toISOString(), points:[point], fromCustomerId:nearest?.km<=.5?nearest.customer.id:null, fromLabel:nearest?.km<=.5?'':`GPS ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, purpose:'Customer visit', lastAccuracy:point.accuracy };
    save(); screen='travel'; render(); resumeTravelTracking(); toast('Mileage tracking started');
  }, 'Allow precise location to record business travel.');
}

function stopTravelTracking({ customerId = null, endPoint = null, purpose = 'Customer visit', promptDetails = true } = {}) {
  const active = data.travel.activeTrip;
  if (!active) return;
  if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId=null; }
  if (endPoint && Number.isFinite(endPoint.lat) && Number.isFinite(endPoint.lng)) {
    const previous=active.points.at(-1);
    if (!previous || geoDistanceKm(previous,endPoint)>.005) active.points.push(endPoint);
  }
  const last = active.points.at(-1) || data.travel.lastPosition;
  const nearest = last ? nearestCustomer(last) : null;
  const distanceKm = routeDistanceKm(active.points);
  const destinationId=customerId||(nearest?.km<=.5?nearest.customer.id:null);
  data.travel.trips.push({ id:active.id, start:active.start, end:new Date().toISOString(), points:active.points, fromCustomerId:active.fromCustomerId, toCustomerId:destinationId, customerId:destinationId, fromLabel:active.fromLabel, toLabel:destinationId?'':last?`GPS ${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}`:'End location', purpose:purpose||active.purpose||'Business travel', startOdometer:null, endOdometer:null, notes:'', distanceSource:'gps', distanceKm, ratePerKm:data.travel.ratePerKm, reimbursement:distanceKm*data.travel.ratePerKm });
  data.travel.activeTrip=null; save(); render(); toast(`${distanceKm.toFixed(1)} km saved · ${currency(reimbursement(distanceKm))} claim`);
  if(promptDetails) tripFormModal(active.id);
}

function downloadFile(filename, content, type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a'); link.href=url; link.download=filename; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function exportBackup(suffix = '') {
  const stamp=currentDate().toISOString().slice(0,10);
  downloadFile(`fieldflow-backup-${stamp}${suffix?`-${suffix}`:''}.json`,JSON.stringify({format:'fieldflow-backup',version:2,exportedAt:new Date().toISOString(),workspace:data},null,2),'application/json');
  toast('Complete FieldFlow backup downloaded');
}

const csvCell = value => `"${String(value??'').replaceAll('"','""')}"`;
function exportKmCsv() {
  let range;try{range=dateRange(travelPeriod,travelCustomStart,travelCustomEnd);}catch{range=dateRange('month');}
  const trips=data.travel.trips.filter(trip=>isInRange(trip.start,range)).sort((a,b)=>new Date(a.start)-new Date(b.start));
  const rows=[['Date','From','To','Restaurant','Business Purpose','Start Odometer','End Odometer','KM','Rate','Reimbursement','Notes'],...trips.map(trip=>[dateInput(trip.start),customer(trip.fromCustomerId)?.name||trip.fromLabel||'',customer(trip.toCustomerId)?.name||trip.toLabel||'',customer(trip.customerId)?.name||'',trip.purpose||'Business travel',trip.startOdometer??'',trip.endOdometer??'',Number(trip.distanceKm||0).toFixed(1),Number(trip.ratePerKm||data.travel.ratePerKm).toFixed(2),Number(trip.reimbursement||0).toFixed(2),trip.notes||''])];
  rows.push(['TOTAL BUSINESS KM','','','','','','',trips.reduce((sum,trip)=>sum+Number(trip.distanceKm||0),0).toFixed(1),'',trips.reduce((sum,trip)=>sum+Number(trip.reimbursement||0),0).toFixed(2),'']);
  downloadFile(`fieldflow-km-${dateInput(range.start)}-to-${dateInput(new Date(range.end.getTime()-DAY))}.csv`,rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  toast('KM report exported');
}

document.addEventListener('click', async event => {
  const target=event.target.closest('[data-screen],[data-action]'); if(!target)return;
  if(target.dataset.screen){screen=target.dataset.screen; filter=target.dataset.filter||'All'; query=''; modalQuery=''; modal=null; render(); return;}
  const action=target.dataset.action;
  if(action==='close-modal'){
    if(target.classList.contains('modal-backdrop') && event.target !== target) return;
    modal=null;render();
  }
  else if(action==='settings')settingsModal();
  else if(action==='start-visit')startVisitModal(target.dataset.id);
  else if(action==='select-visit-customer'){startVisitModal(target.dataset.id);}
  else if(action==='confirm-start'){
    const c=customer(target.dataset.id); target.disabled=true; target.innerHTML=`${icon('pin')} Capturing location…`;
    const finish=(coords,label)=>{const point=coords?{lat:coords.latitude,lng:coords.longitude,accuracy:coords.accuracy,capturedAt:new Date().toISOString()}:null;if(data.travel.activeTrip)stopTravelTracking({customerId:c.id,endPoint:point,purpose:'Customer visit',promptDetails:false});if(point)data.travel.lastPosition=point;const firstPin=point&&!hasCustomerLocation(c);if(firstPin){c.lat=point.lat;c.lng=point.lng;}const venueDistance=point?geoDistanceKm(point,{lat:c.lat,lng:c.lng}):Infinity;const locationLabel=firstPin?'Venue pinned from first visit':point?`${label} · ${distanceLabel(venueDistance)} from venue`:label;data.activeVisit={id:`v${Date.now()}`,customerId:c.id,start:new Date().toISOString(),lat:point?.lat??c.lat,lng:point?.lng??c.lng,locationLabel,note:'',wineOutcomes:[],feedbackOutcome:'General relationship visit',currentWineIds:winesForCustomer(c.id).filter(item=>item.status==='Listed').map(item=>item.wineId),contactSnapshot:{placeName:c.name||'',person:c.contact||'',role:c.role||'',address:c.address||'',phone:c.phone||'',email:c.email||''},nextAction:'',followUpRequired:false,followUpAt:'',followUpReason:'',followUpContact:c.contact||'',menuChangeDate:dateInput(c.menuChangeDate),menuChangeMonth:c.menuChangeMonth||'',listingsReopenAt:dateInput(c.listingsReopenAt),listingsReopenMonth:c.listingsReopenMonth||'',listingReminderDays:c.listingReminderDays||60};save();modal=null;screen='visit';render();toast(firstPin?'Visit started and client location pinned':'Visit started and location saved');};
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>finish(p.coords,'Live location captured'),()=>finish(null,'Venue location used'),{enableHighAccuracy:true,timeout:6000,maximumAge:60000}); else finish(null,'Venue location used');
  }
  else if(action==='customer')customerDetail(target.dataset.id);
  else if(action==='visit-detail')visitDetail(target.dataset.id);
  else if(action==='product-detail')productDetail(target.dataset.id);
  else if(action==='add-customer')customerFormModal();
  else if(action==='edit-customer')customerFormModal(target.dataset.id);
  else if(action==='filter'){filter=target.dataset.value;render();}
  else if(action==='product-brand'){productFilter=target.dataset.value;query='';render();}
  else if(action==='product-status-filter'){productRelationshipFilter=target.dataset.value;query='';render();}
  else if(action==='activity-mode'){filter=target.dataset.value==='tasks'?'tasks':target.dataset.value==='cycles'?'cycles':'All';query='';render();}
  else if(action==='report-period'){reportPeriod=target.dataset.value;render();}
  else if(action==='travel-period'){travelPeriod=target.dataset.value;render();}
  else if(action==='apply-report-range'){reportCustomStart=document.getElementById('report-custom-start')?.value||'';reportCustomEnd=document.getElementById('report-custom-end')?.value||'';try{dateRange('custom',reportCustomStart,reportCustomEnd);render();}catch(error){toast(error.message);}}
  else if(action==='apply-travel-range'){travelCustomStart=document.getElementById('travel-custom-start')?.value||'';travelCustomEnd=document.getElementById('travel-custom-end')?.value||'';try{dateRange('custom',travelCustomStart,travelCustomEnd);render();}catch(error){toast(error.message);}}
  else if(action==='locate-customers'){
    const stayOnTravel=screen==='travel';
    target.disabled=true;
    captureDeviceLocation(point=>{const nearest=nearestCustomer(point);screen=stayOnTravel?'travel':'customers';modal=null;render();toast(nearest?`${nearest.customer.name} is closest · ${distanceLabel(nearest.km)} away`:'Location captured. Pin a client to compare distance.');});
  }
  else if(action==='set-customer-location'){
    const c=customer(target.dataset.id); target.disabled=true;
    captureDeviceLocation(point=>{c.lat=point.lat;c.lng=point.lng;save();customerDetail(c.id);toast(`${c.name} location updated from this device`);},'Allow precise location to save this client position.');
  }
  else if(action==='start-travel')startTravelTracking();
  else if(action==='stop-travel')stopTravelTracking();
  else if(action==='add-trip')tripFormModal();
  else if(action==='edit-trip')tripFormModal(target.dataset.id);
  else if(action==='delete-trip'){const trip=data.travel.trips.find(item=>item.id===target.dataset.id);if(!trip||!confirm(`Delete the ${Number(trip.distanceKm||0).toFixed(1)} km trip? This cannot be undone.`))return;data.travel.trips=data.travel.trips.filter(item=>item.id!==trip.id);save();modal=null;render();toast('Trip deleted');}
  else if(action==='toggle-task'){const t=data.tasks.find(x=>x.id===target.dataset.id);t.done=!t.done;t.completedAt=t.done?new Date().toISOString():null;if(t.wineId){const relation=findCustomerWine(data,t.customerId,t.wineId);if(relation)relation.followUpAt=t.done?null:t.due;}const visit=data.visits.find(item=>item.followUpTaskId===t.id);if(visit)visit.followUpCompleted=t.done;save();if(modal?.includes('data-action="add-customer-task"'))customerDetail(t.customerId);else render();toast(t.done?'Follow-up completed':'Follow-up reopened');}
  else if(action==='add-task')taskModal();
  else if(action==='add-customer-task')taskModal(null,{customerId:target.dataset.id,contactPerson:customer(target.dataset.id)?.contact||''});
  else if(action==='edit-task')taskModal(target.dataset.id);
  else if(action==='delete-task'){if(!confirm('Delete this follow-up?'))return;const task=data.tasks.find(item=>item.id===target.dataset.id);if(task?.wineId){const relation=findCustomerWine(data,task.customerId,task.wineId);if(relation?.followUpAt===task.due)relation.followUpAt=null;}const visit=data.visits.find(item=>item.followUpTaskId===task?.id);if(visit){visit.followUpTaskId=null;visit.followUpCompleted=false;}data.tasks=data.tasks.filter(item=>item.id!==target.dataset.id);save();modal=null;render();toast('Follow-up deleted');}
  else if(action==='add-visit-wine'){modalQuery='';winePickerModal('visit');}
  else if(action==='pick-visit-wine'){if(!data.activeVisit.wineOutcomes.some(item=>item.wineId===target.dataset.id))data.activeVisit.wineOutcomes.push({wineId:target.dataset.id,outcome:'Discussed',sampleLeft:false});save();modal=null;render();toast('Wine added to visit');}
  else if(action==='remove-visit-wine'){data.activeVisit.wineOutcomes=data.activeVisit.wineOutcomes.filter(item=>item.wineId!==target.dataset.id);save();render();}
  else if(action==='add-customer-wine'){modalQuery='';winePickerModal('customer',target.dataset.id);}
  else if(action==='pick-customer-wine'){wineRelationshipModal({customerId:target.dataset.customerId,wineId:target.dataset.id});}
  else if(action==='edit-customer-wine')wineRelationshipModal({relationId:target.dataset.id});
  else if(action==='assign-product')wineRelationshipModal({wineId:target.dataset.id});
  else if(action==='set-wine-status'){const relation=customerWine(target.dataset.id);if(!relation)return;upsertCustomerWine(data,{customerId:relation.customerId,wineId:relation.wineId,status:target.dataset.status,allocation:relation.allocation,notes:relation.notes,followUpAt:relation.followUpAt});save();customerDetail(relation.customerId);toast(target.dataset.status==='Listed'?'Confirmed listing saved':'Delisting saved; history retained');}
  else if(action==='wine-follow-up'){const relation=customerWine(target.dataset.id);taskModal(null,{customerId:relation.customerId,wineId:relation.wineId,title:`Follow up on ${wine(relation.wineId)?.name||'wine'}`,due:relation.followUpAt||iso(1,9)});}
  else if(action==='delete-visit'){const visit=data.visits.find(item=>item.id===target.dataset.id);if(!visit||!confirm('Delete this visit record? Wine status history will be retained.'))return;data.visits=data.visits.filter(item=>item.id!==visit.id);data.tasks.forEach(task=>{if(task.visitId===visit.id)task.visitId=null;});const c=customer(visit.customerId);const latest=data.visits.filter(item=>item.customerId===visit.customerId).sort((a,b)=>new Date(b.start)-new Date(a.start))[0];if(c)c.lastVisit=latest?.start||null;save();modal=null;render();toast('Visit deleted');}
  else if(action==='retry-save'){try{save();render();toast('Saved on this device');}catch{showSaveWarning();}}
  else if(action==='voice-undo'){stopVoiceCapture();if(voiceUndo?.id===data.activeVisit?.id){data.activeVisit.note=voiceUndo.note;voiceUndo=null;save();render();}}
  else if(action==='edit-visit')editVisitModal(target.dataset.id);
  else if(action==='voice')startVoiceCapture();
  else if(action==='structure-note'){const box=document.getElementById('visit-note');data.activeVisit.note=box.value;const structured=structureNote(box.value);for(const name of structured.products){const product=data.products.find(item=>item.name===name);if(product&&!data.activeVisit.wineOutcomes.some(item=>item.wineId===product.id))data.activeVisit.wineOutcomes.push({wineId:product.id,outcome:'Discussed',sampleLeft:false});}if(!data.activeVisit.nextAction)data.activeVisit.nextAction=structured.nextAction||'';if(data.activeVisit.feedbackOutcome==='General relationship visit')data.activeVisit.feedbackOutcome=structured.feedbackOutcome;if(structured.followUp&&!data.activeVisit.followUpRequired){data.activeVisit.followUpRequired=true;data.activeVisit.followUpAt=dateInput(structured.followUp);data.activeVisit.followUpReason=structured.nextAction||'Follow up after visit';}save();render();toast('Note structured — check the suggested fields');}
  else if(action==='end-visit'){
    stopVoiceCapture(); const before=clone(data); const note=document.getElementById('visit-note')?.value??data.activeVisit.note??''; const s=structureNote(note); const active=data.activeVisit; const c=customer(active.customerId);
    const isClosed=active.feedbackOutcome==='Not doing listings now / No current listing opportunity';if(isClosed&&!active.listingsReopenAt&&!active.listingsReopenMonth&&!active.menuChangeDate&&!active.menuChangeMonth){const cycle=document.querySelector('.visit-cycle-details');if(cycle){cycle.open=true;cycle.scrollIntoView({block:'center'});}toast('Add when listings reopen, or the menu-change date/month.');return;}if(active.followUpRequired&&(!active.followUpAt||!active.followUpReason)){toast('Add the follow-up date and reason, or choose No.');return;}
    const selected=[...(active.wineOutcomes||[])];for(const name of s.products){const product=data.products.find(item=>item.name===name);if(product&&!selected.some(item=>item.wineId===product.id))selected.push({wineId:product.id,outcome:'Discussed',sampleLeft:false});}const followUpAt=active.followUpRequired?dateTimeAtNine(active.followUpAt):null;const visit={id:active.id,customerId:active.customerId,start:active.start,end:new Date().toISOString(),lat:active.lat,lng:active.lng,rawNote:note,summary:s.summary,products:selected.map(item=>wine(item.wineId)?.name).filter(Boolean),wineOutcomes:selected,outcome:s.outcome,feedbackOutcome:active.feedbackOutcome||s.feedbackOutcome,nextAction:active.nextAction||s.nextAction||'',followUp:followUpAt,followUpRequired:Boolean(active.followUpRequired),followUpReason:active.followUpReason||'',followUpContact:active.followUpContact||'',followUpCompleted:false,followUpTaskId:null,currentWineIds:active.currentWineIds||[],samplesLeftWineIds:selected.filter(item=>item.sampleLeft).map(item=>item.wineId),contactSnapshot:{...(active.contactSnapshot||{})},menuChangeDate:active.menuChangeDate||null,menuChangeMonth:active.menuChangeMonth||'',listingsReopenAt:dateTimeAtNine(active.listingsReopenAt),listingsReopenMonth:active.listingsReopenMonth||'',listingReminderDays:Number(active.listingReminderDays)||60,source:active.source||'typed'};applyVisitWineOutcomes(data,visit,followUpAt||iso(1,9));
    c.lastVisit=active.start;const snapshot=visit.contactSnapshot;if(snapshot.placeName)c.name=snapshot.placeName;if(snapshot.person)c.contact=snapshot.person;if(snapshot.role)c.role=snapshot.role;if(snapshot.address)c.address=snapshot.address;if(snapshot.phone)c.phone=snapshot.phone;if(snapshot.email)c.email=snapshot.email;c.menuChangeDate=visit.menuChangeDate;c.menuChangeMonth=visit.menuChangeMonth;c.listingsReopenAt=visit.listingsReopenAt;c.listingsReopenMonth=visit.listingsReopenMonth;c.listingReminderDays=visit.listingReminderDays;
    let tasksAdded=0;if(active.followUpRequired){const task=createFollowUp({customerId:c.id,visitId:visit.id,title:visit.nextAction||`Follow up after ${visit.feedbackOutcome}`,due:followUpAt,reason:active.followUpReason,contactPerson:active.followUpContact||snapshot.person||c.contact||''});visit.followUpTaskId=task.id;tasksAdded++;}for(const item of selected.filter(item=>item.outcome==='Follow-up required')){createFollowUp({customerId:c.id,wineId:item.wineId,visitId:visit.id,title:`Follow up on ${wine(item.wineId)?.name||'wine'}`,due:followUpAt||iso(1,9),reason:active.followUpReason||'Wine follow-up',contactPerson:active.followUpContact||snapshot.person||c.contact||''});tasksAdded++;}data.visits.push(visit);
    data.activeVisit=null;try{save();}catch{data=before;showSaveWarning();return;}screen='home';render();toast(tasksAdded?'Visit saved and follow-up added':'Visit saved');
  }
  else if(action==='ask')ask(target.dataset.value);
  else if(action==='email-pricelist')emailPriceList();
  else if(action==='print-pricelist')window.print();
  else if(action==='export-km')exportKmCsv();
  else if(action==='print-km')window.print();
  else if(action==='share-report')emailReport();
  else if(action==='export-backup')exportBackup();
  else if(action==='import-backup')document.getElementById('backup-file')?.click();
  else if(action==='cloud-sync'){target.disabled=true;const synced=await refreshCloud();settingsModal();toast(synced?'Cloud backup is up to date':'Sync needs attention — check your connection and status');}
  else if(action==='cloud-review'){try{await cloudDifferencesModal();}catch(error){toast(error.message);}}
  else if(action==='cloud-choose'){
    if(!confirm('Use this copy of the record? A recovery backup will download first.'))return;
    exportBackup('-before-sync-choice');
    try{await resolveCloudDifference(target.dataset.token,target.dataset.choice);await cloudDifferencesModal();toast('Choice saved on this device. Tap Sync now when finished.');}catch(error){toast(error.message);}
  }
  else if(action==='cloud-signout'){target.disabled=true;try{await signOutCloud();modal=null;render();toast('Signed out. Account data is locked on this device.');}catch(error){toast(error.message);}}
  else if(action==='install-app'){
    if(isSamsungInternet||!deferredInstallPrompt){installHelpModal();return;}
    target.disabled=true;
    await deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    modal=null;
    render();
    toast(choice.outcome==='accepted'?'FieldFlow is being installed.':'Installation cancelled. You can install it later from your profile.');
  }
  else if(action==='open-in-chrome'){
    const secureUrl='https://ernest01982.github.io/onconapp/';
    const fallback=encodeURIComponent(secureUrl);
    window.location.href=`intent://ernest01982.github.io/onconapp/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }
  else if(action==='clear-crm-data'){if(cloudState.signedIn){toast('Bulk cloud deletion is disabled to protect linked history. Export your backup before arranging a full account reset.');return;}if(!confirm('Clear this guest workspace? A recovery backup will download first. Your signed-in account is not affected.'))return;exportBackup('before-clear');const profile=clone(data.profile);const products=clone(data.products?.length?data.products:realProducts);data=normalizeWorkspace(clone(seed),products);data.profile=profile;data.products=products;save();modal=null;screen='home';render();toast('CRM activity cleared. Your real price list remains.');}
});

document.addEventListener('input', event => {
  if(event.target.id==='search'){query=event.target.value; const pos=event.target.selectionStart;render();const input=document.getElementById('search');input?.focus();input?.setSelectionRange(pos,pos);}
  if(event.target.id==='wine-picker-search'){modalQuery=event.target.value;const pos=event.target.selectionStart;winePickerModal(pickerContext?.mode||'visit',pickerContext?.customerId||null);const input=document.getElementById('wine-picker-search');input?.focus();input?.setSelectionRange(pos,pos);}
  if(event.target.id==='visit-note'&&data.activeVisit){stopVoiceCapture();data.activeVisit.note=event.target.value;try{save();}catch{showSaveWarning();}}
  if(event.target.matches('[data-visit-field]')&&data.activeVisit){const field=event.target.dataset.visitField;const contactFields={contactPlaceName:'placeName',contactPerson:'person',contactRole:'role',contactAddress:'address',contactPhone:'phone',contactEmail:'email'};if(contactFields[field]){data.activeVisit.contactSnapshot||={};data.activeVisit.contactSnapshot[contactFields[field]]=event.target.value;}else if(field==='listingReminderDays')data.activeVisit[field]=Number(event.target.value);else if(field!=='followUpRequired')data.activeVisit[field]=event.target.value;save();}
});

document.addEventListener('change', async event => {
  if(event.target.matches('[data-visit-wine-outcome]')&&data.activeVisit){const item=data.activeVisit.wineOutcomes.find(entry=>entry.wineId===event.target.dataset.visitWineOutcome);if(item){item.outcome=event.target.value;save();render();}}
  if(event.target.matches('[data-visit-wine-sample]')&&data.activeVisit){const item=data.activeVisit.wineOutcomes.find(entry=>entry.wineId===event.target.dataset.visitWineSample);if(item){item.sampleLeft=event.target.checked;save();render();}}
  if(event.target.dataset.visitField==='followUpRequired'&&data.activeVisit){data.activeVisit.followUpRequired=event.target.value==='true';if(data.activeVisit.followUpRequired&&!data.activeVisit.followUpAt)data.activeVisit.followUpAt=dateInput(iso(1,9));save();render();}
  if(event.target.id==='backup-file'&&event.target.files?.[0]){
    try{
      const parsed=JSON.parse(await event.target.files[0].text());
      if(parsed?.format!=='fieldflow-backup'||!parsed.workspace||!Array.isArray(parsed.workspace.customers)||!Array.isArray(parsed.workspace.visits))throw new Error('This is not a valid FieldFlow backup.');
      if(!confirm('Import this backup and replace the current workspace? A safety copy will be downloaded first.'))return;
      exportBackup('before-import');
      data=normalizeWorkspace({...clone(seed),...parsed.workspace,products:parsed.workspace.products?.length?parsed.workspace.products:realProducts},realProducts);
      save();modal=null;screen=data.activeVisit?'visit':'home';render();toast('Backup imported successfully');
    }catch(error){toast(error.message||'Could not import this backup.');}
  }
});

document.addEventListener('keydown', event => {
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('article[data-action], .interactive[data-action]')){event.preventDefault();event.target.click();}
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  if(event.target.id==='edit-visit-form'){
    const visit=data.visits.find(item=>item.id===event.target.dataset.id);if(!visit)return;
    const before=clone(visit),fd=new FormData(event.target);
    visit.rawNote=String(fd.get('rawNote')||'');visit.summary=structureNote(visit.rawNote).summary;
    visit.feedbackOutcome=String(fd.get('feedbackOutcome'));visit.nextAction=String(fd.get('nextAction')||'');
    try{save();}catch{Object.assign(visit,before);return;}
    visitDetail(visit.id);toast('Visit corrections saved');
  }
  if(event.target.id==='ask-form'){const input=document.getElementById('ask-input');ask(input.value);}
  if(event.target.id==='auth-form'){
    const fd=new FormData(event.target);const email=String(fd.get('email')||'').trim();const password=String(fd.get('password')||'');
    [...event.target.querySelectorAll('button')].forEach(button=>button.disabled=true);
    try{await signInWithEmail(email,password);toast('Signed in. Your cloud data is loading.');}catch(error){toast(error.message);settingsModal();}
  }
  if(event.target.id==='task-form'){const fd=new FormData(event.target);const id=event.target.dataset.id;const existing=id?data.tasks.find(item=>item.id===id):null;const oldDue=existing?.due||null;const due=dateTimeAtNine(String(fd.get('due'))),done=String(fd.get('done'))==='true',rescheduled=Boolean(existing&&oldDue&&oldDue!==due);const values={customerId:String(fd.get('customerId')),wineId:String(fd.get('wineId')||'')||null,title:String(fd.get('title')||'').trim(),reason:String(fd.get('reason')||'').trim(),contactPerson:String(fd.get('contactPerson')||'').trim(),due,done,completedAt:done?(existing?.completedAt||new Date().toISOString()):null,priority:existing?.priority||'Next',reminderType:'followup',rescheduleHistory:existing?.rescheduleHistory||[]};if(rescheduled)values.rescheduleHistory=[...values.rescheduleHistory,{from:oldDue,to:due,at:new Date().toISOString()}].slice(-50);if(existing)Object.assign(existing,values);else data.tasks.push({id:`t${Date.now()}`,...values,visitId:null});const task=existing||data.tasks.at(-1);if(values.wineId){const relation=findCustomerWine(data,values.customerId,values.wineId);if(relation)relation.followUpAt=done?null:values.due;}const visit=data.visits.find(item=>item.followUpTaskId===task.id);if(visit){visit.followUp=values.due;visit.followUpReason=values.reason;visit.followUpContact=values.contactPerson;visit.followUpCompleted=values.done;}save();modal=null;render();toast(existing?(rescheduled?'Follow-up rescheduled':'Follow-up updated'):'Follow-up added');}
  if(event.target.id==='wine-relation-form'){
    const fd=new FormData(event.target);const existing=event.target.dataset.id?customerWine(event.target.dataset.id):null;const customerId=String(fd.get('customerId')),wineId=String(fd.get('wineId')),status=String(fd.get('status')),followUpAt=dateTimeAtNine(String(fd.get('followUp')||''));
    const relation=upsertCustomerWine(data,{customerId,wineId,status,listingDate:dateTimeAtNine(String(fd.get('listingDate')||'')),allocation:String(fd.get('allocation')||''),notes:String(fd.get('notes')||''),followUpAt});
    if(followUpAt)createFollowUp({customerId,wineId,title:`Follow up on ${wine(wineId)?.name||'wine'}`,due:followUpAt});
    save();modal=null;customerDetail(customerId);toast(existing?'Wine status updated':'Wine linked to restaurant');
  }
  if(event.target.id==='trip-form'){
    const fd=new FormData(event.target);const id=event.target.dataset.id;const existing=id?data.travel.trips.find(item=>item.id===id):null;
    try{
      const result=calculateTripDistance({startOdometer:fd.get('startOdometer'),endOdometer:fd.get('endOdometer'),manualDistance:fd.get('distanceKm'),gpsDistance:existing?.distanceSource==='gps'?existing.distanceKm:0});
      const start=new Date(`${fd.get('date')}T${fd.get('time')}:00`);if(Number.isNaN(start.getTime()))throw new Error('Choose a valid trip date and time.');const originalDuration=existing?Math.max(60000,new Date(existing.end)-new Date(existing.start)):60000;const customerId=String(fd.get('customerId')||'')||null;const rate=Number(existing?.ratePerKm||data.travel.ratePerKm);
      const values={start:start.toISOString(),end:new Date(start.getTime()+originalDuration).toISOString(),points:existing?.points||[],fromCustomerId:existing?.fromCustomerId||null,toCustomerId:customerId||existing?.toCustomerId||null,customerId,fromLabel:String(fd.get('fromLabel')||'').trim(),toLabel:String(fd.get('toLabel')||'').trim()||(customerId?customer(customerId)?.name:''),purpose:String(fd.get('purpose')||'').trim(),startOdometer:result.startOdometer,endOdometer:result.endOdometer,notes:String(fd.get('notes')||'').trim(),distanceSource:result.distanceSource,distanceKm:result.distanceKm,ratePerKm:rate,reimbursement:result.distanceKm*rate};
      if(existing)Object.assign(existing,values);else data.travel.trips.push({id:`trip${Date.now()}`,...values});save();modal=null;screen='travel';render();toast(existing?'Trip updated':'Business trip added');
    }catch(error){toast(error.message);}
  }
  if(event.target.id==='customer-form'){
    const fd=new FormData(event.target); const id=event.target.dataset.id; const existing=id?customer(id):null; const useCurrent=fd.get('useCurrentLocation')==='on'&&data.travel.lastPosition;
    const values={name:String(fd.get('name')).trim(),type:String(fd.get('type')),area:String(fd.get('area')).trim(),address:String(fd.get('address')).trim(),contact:String(fd.get('contact')).trim(),role:String(fd.get('role')).trim(),email:String(fd.get('email')).trim(),phone:String(fd.get('phone')).trim(),opportunity:String(fd.get('opportunity')).trim(),value:Number(fd.get('value'))||0,menuChangeDate:String(fd.get('menuChangeDate')||'')||null,menuChangeMonth:String(fd.get('menuChangeMonth')||''),listingsReopenAt:dateTimeAtNine(String(fd.get('listingsReopenAt')||'')),listingsReopenMonth:String(fd.get('listingsReopenMonth')||''),listingReminderDays:Number(fd.get('listingReminderDays'))||60,listingCycleNotes:String(fd.get('listingCycleNotes')||'').trim()};
    if(existing){Object.assign(existing,values);if(useCurrent){existing.lat=data.travel.lastPosition.lat;existing.lng=data.travel.lastPosition.lng;}}
    else {data.customers.push({id:`c${Date.now()}`,...values,lastVisit:null,lat:useCurrent?data.travel.lastPosition.lat:null,lng:useCurrent?data.travel.lastPosition.lng:null,createdAt:new Date().toISOString()});}
    save();modal=null;screen='customers';filter='All';query='';render();toast(existing?'Client details updated':'New client added');
  }
});

function stopVoiceCapture(){
  const current=voiceSession;
  if(!current)return;
  voiceSession=null;
  current.recognition.abort();
  document.getElementById('voice-button')?.classList.remove('listening');
  const help=document.getElementById('voice-help');
  if(help)help.textContent='Stopped. Your note is kept. Tap to add more.';
}
function startVoiceCapture(){
  if(voiceSession){stopVoiceCapture();render();return;}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const help=document.getElementById('voice-help');
  if(!Recognition){help.textContent='Use the microphone on your phone keyboard, or type below.';document.getElementById('visit-note')?.focus();return;}
  const active=data.activeVisit;if(!active)return;
  const base=active.note||'';
  if(base.length>=4000){help.textContent='Note is full (4,000 characters). Edit it before adding more.';return;}
  const recognition=new Recognition();
  const current={recognition,id:active.id,workspace:activeWorkspaceKey,base};
  voiceUndo={id:active.id,note:base};voiceSession=current;
  recognition.lang='en-ZA';recognition.interimResults=true;
  document.getElementById('voice-button')?.classList.add('listening');
  help.textContent='Listening — tap the microphone again to stop.';
  recognition.onresult=e=>{
    if(voiceSession!==current||data.activeVisit?.id!==current.id||activeWorkspaceKey!==current.workspace)return;
    const transcript=Array.from(e.results).map(r=>r[0].transcript).join(' ');
    const combined=[base,transcript].filter(Boolean).join('\n');
    data.activeVisit.note=combined.slice(0,4000);data.activeVisit.source='voice';
    const box=document.getElementById('visit-note');if(box)box.value=data.activeVisit.note;
    try{save();}catch{stopVoiceCapture();return;}
    if(combined.length>4000){stopVoiceCapture();help.textContent='Note reached 4,000 characters. Extra speech was not captured; shorten the note before continuing.';}
  };
  recognition.onerror=()=>{if(voiceSession===current){stopVoiceCapture();help.textContent='Voice stopped. Your existing note is kept. Try again or use your keyboard.';}};
  recognition.onend=()=>{if(voiceSession===current){voiceSession=null;render();}};
  try{recognition.start();}catch{stopVoiceCapture();help.textContent='Could not start the microphone. Use the keyboard microphone or type.';}
}
function editVisitModal(id){
  const visit=data.visits.find(item=>item.id===id);if(!visit)return;
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="edit-visit-form" data-id="${esc(id)}"><div class="modal-head"><h2>Edit visit notes</h2><button class="close-btn" type="button" data-action="close-modal" aria-label="Close">${icon('x')}</button></div><p class="modal-hint">Correct this visit without creating another visit, changing listing history or duplicating reminders. Use the linked follow-up to reschedule.</p><div class="form-group"><label for="edit-raw-note">Full note</label><textarea class="field" id="edit-raw-note" name="rawNote" maxlength="4000">${esc(visit.rawNote??visit.summary??'')}</textarea></div><div class="form-group"><label for="edit-feedback">Feedback / outcome</label><select class="field" id="edit-feedback" name="feedbackOutcome">${FEEDBACK_OUTCOMES.map(value=>`<option ${value===visit.feedbackOutcome?'selected':''}>${esc(value)}</option>`).join('')}</select></div><div class="form-group"><label for="edit-next">Next action</label><input class="field" id="edit-next" name="nextAction" maxlength="1000" value="${esc(visit.nextAction||'')}"></div><button class="btn btn-primary btn-block sticky-save">Save corrections</button></form></div>`;render();
}

function selectedProducts(){return data.products.filter(p=>p.active&&(productFilter==='All'||p.brand===productFilter)&&(productRelationshipFilter==='All'||customersForWine(p.id).some(item=>productRelationshipFilter==='Listed'?item.status==='Listed':productRelationshipFilter==='Interested'?PIPELINE_STATUSES.includes(item.status):item.followUpAt&&new Date(item.followUpAt)<=new Date())));}
function priceListText(){return selectedProducts().map(p=>`${p.sku} · ${p.name} (${p.pack}) — case ${currency(p.price)}${p.unitPrice!=null?`, unit ${currency(p.unitPrice)}`:''} incl. VAT`).join('\n');}
function emailPriceList(){const listName=productFilter==='All'?'Complete portfolio':productFilter;const subject=`Niew Beverages On Con price list — ${listName}`;const body=`Hi,\n\nPlease find the Niew Beverages On Con pricing effective 1 March 2026 below. Prices include VAT.\n\n${priceListText()}\n\nPlease let me know if you would like to place an order or confirm availability.\n\nRegards,\n${data.profile.name}`;window.location.href=`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;}
function emailReport(){let range;try{range=dateRange(reportPeriod,reportCustomStart,reportCustomEnd);}catch{range=dateRange('week');}const visits=data.visits.filter(v=>isInRange(v.start,range)),trips=data.travel.trips.filter(t=>isInRange(t.start,range)),km=trips.reduce((sum,t)=>sum+Number(t.distanceKm||0),0),claim=trips.reduce((sum,t)=>sum+Number(t.reimbursement||0),0),mins=visits.reduce((n,v)=>n+(new Date(v.end)-new Date(v.start))/60000,0),pipeline=data.customerWines.filter(item=>PIPELINE_STATUSES.includes(item.status)),windows=cycleReminders(),priorityWindows=windows.filter(item=>item.state!=='upcoming');const body=`Field activity — ${range.label}\n\nVisits: ${visits.length}\nCustomers seen: ${new Set(visits.map(v=>v.customerId)).size}\nTime in trade: ${Math.round(mins/60)} hours\nOpen follow-ups: ${data.tasks.filter(t=>!t.done).length}\nListing windows open or approaching: ${priorityWindows.length}\nFuture listing windows scheduled: ${windows.filter(item=>item.state==='upcoming').length}\nWine pipeline: ${pipeline.length}\nConfirmed active listings: ${activeListings().length}\nBusiness travel: ${km.toFixed(1)} km across ${trips.length} trips\nReimbursement claim: ${currency(claim)}\nOpen opportunity value: ${currency(data.customers.reduce((s,c)=>s+c.value,0))}`;window.location.href=`mailto:?subject=${encodeURIComponent(`Field sales activity — ${range.label}`)}&body=${encodeURIComponent(body)}`;}

window.addEventListener('online',()=>{render();syncCloudNow(false);});window.addEventListener('offline',render);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=isSamsungInternet?null:event;if(screen==='home'||modal?.includes('data-modal="settings"'))render();});
window.addEventListener('appinstalled',()=>{appInstalled=true;deferredInstallPrompt=null;modal=null;render();toast('FieldFlow is installed and ready.');});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(registration=>registration.update()).catch(()=>{}));
render();
initializeCloud({
  checkpoint:()=>persistLocal(),
  getData:()=>data,
  setData:remote=>{data=normalizeWorkspace({...data,...remote},realProducts);persistLocal();screen=data.activeVisit?'visit':'home';modal=null;render();toast('Cloud data is ready on this device.');},
  onIdentityChange:user=>activateWorkspace(user),
  onStatus:next=>{if(next.lastSynced&&next.lastSynced!==cloudState.lastSynced&&!next.error)cloudDirty=false;cloudState=next;if(screen==='home'||modal?.includes('data-modal="settings"'))render();}
});
