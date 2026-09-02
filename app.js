import { realProducts } from './products-data.js';
import { initializeCloud, scheduleCloudSync, signInWithEmail, signOutCloud, syncCloudNow } from './cloud.js';
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
const now = new Date();
const iso = (offset = 0, hour = 9, minute = 0) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute);
  return d.toISOString();
};

const seed = {
  profile: { name: 'Ernest', initials: 'ER', territory: 'Johannesburg North' },
  customers: [],
  visits: [],
  tasks: [],
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
  if (LEGACY_DEMO_CUSTOMERS.has(cleaned.activeVisit?.customerId)) cleaned.activeVisit = null;
  if (!cleaned.customers.length && !cleaned.visits.length && !cleaned.tasks.length) cleaned.chat = clone(seed.chat);
  return cleaned;
};
let activeWorkspaceKey = workspaceKeyFor(null);
const loadState = key => removeLegacyDemoData(readWorkspace(localStorage, key, seed));
migrateLegacyWorkspaceToGuest(localStorage, seed, removeLegacyDemoData);
let data = loadState(activeWorkspaceKey);
let screen = data.activeVisit ? 'visit' : 'home';
let filter = 'All';
let productFilter = 'All';
let query = '';
let modal = null;
let timerId = null;
let travelTimerId = null;
let locationWatchId = null;
let cloudState = { configured:false, signedIn:false, email:'', syncing:false, lastSynced:null, error:'' };
let deferredInstallPrompt = null;
let appInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isSamsungInternet = /SamsungBrowser/i.test(navigator.userAgent);

const persistLocal = () => writeWorkspace(localStorage, activeWorkspaceKey, data);
const save = () => { persistLocal(); scheduleCloudSync(); };
async function activateWorkspace(user) {
  const transition = () => activateWorkspaceUnlocked(user);
  if (navigator.locks?.request) return navigator.locks.request('fieldflow-workspace-transition', transition);
  return transition();
}

function activateWorkspaceUnlocked(user) {
  const userId = user?.id || null;
  const nextKey = workspaceKeyFor(userId);
  const guest = loadState(workspaceKeyFor(null));
  const guestHasWork = guest.customers.length || guest.visits.length || guest.tasks.length || guest.travel.trips.length || guest.activeVisit || guest.travel.activeTrip;
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
  query = '';
  modal = null;
  render();
}
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const customer = id => data.customers.find(c => c.id === id);
const currency = value => new Intl.NumberFormat('en-ZA', { style:'currency', currency:'ZAR' }).format(value);
const shortDate = value => new Intl.DateTimeFormat('en-ZA', { day:'numeric', month:'short' }).format(new Date(value));
const time = value => new Intl.DateTimeFormat('en-ZA', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
const dayLabel = value => {
  if (!value) return 'Never';
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
const todayTrips = () => data.travel.trips.filter(trip => new Date(trip.start).toDateString() === now.toDateString());
const currentTripKm = () => data.travel.activeTrip ? routeDistanceKm(data.travel.activeTrip.points || []) : 0;
const distanceLabel = km => Number.isFinite(km) ? (km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`) : 'Location not pinned';
const storageLabel = () => !navigator.onLine ? 'Working offline' : cloudState.signedIn ? (cloudState.syncing ? 'Syncing…' : 'Cloud backed up') : 'Saved on device';

const icons = {
  home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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
  const item = document.createElement('div'); item.className = 'toast'; item.textContent = message; region.append(item);
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
  const pending = data.tasks.filter(t => !t.done).sort((a,b)=>new Date(a.due)-new Date(b.due));
  const todayVisits = data.visits.filter(v => new Date(v.start).toDateString() === now.toDateString());
  const active = data.activeVisit;
  const activeTrip = data.travel.activeTrip;
  const hasCustomers = data.customers.length > 0;
  const todayKm = todayTrips().reduce((sum,trip)=>sum+trip.distanceKm,0);
  return `${topbar(`Good ${now.getHours()<12?'morning':now.getHours()<18?'afternoon':'evening'}`, now.toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'}))}
  <main class="content">
    ${activeTrip ? `<section class="card driving-card"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">Mileage tracking active</span></div><div class="travel-live"><div><strong data-trip-distance>${currentTripKm().toFixed(1)} km</strong><span>Distance</span></div><div><strong data-travel-timer>${duration(activeTrip.start)}</strong><span>Driving time</span></div></div><p>GPS points are saving on this device.</p><button class="btn btn-primary btn-block" data-screen="travel">Open mileage tracker</button></section>` : ''}
    ${active ? `<section class="card active-visit"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">Visit in progress</span></div><div class="timer" data-timer>${duration(active.start)}</div><h2 style="margin:0 0 5px">${esc(customer(active.customerId)?.name)}</h2><p>${esc(customer(active.customerId)?.area)} · location saved</p><button class="btn btn-primary btn-block" data-screen="visit">Open visit</button></section>` : `<section class="card hero"><p class="eyebrow">Your day, made simple</p><h2>${pending.length ? `${pending.length} follow-ups. One clear plan.` : hasCustomers ? 'You’re all caught up.' : 'Add your first client.'}</h2><p>${pending.length ? `Start with ${esc(customer(pending[0].customerId)?.name)}, then keep moving.` : hasCustomers ? 'Start a visit when you arrive at your next customer.' : 'Save the venue and contact once, then every visit becomes quicker.'}</p><div class="hero-actions"><button class="btn btn-primary" data-action="${hasCustomers?'start-visit':'add-customer'}">${icon('plus')} ${hasCustomers?'Start visit':'Add first client'}</button><button class="btn btn-white" data-screen="assistant">${icon('spark')} Ask AI</button></div></section>`}
    ${!appInstalled ? `<section class="card install-card"><div class="install-icon">${icon('download','icon-lg')}</div><div><strong>Put FieldFlow on your phone</strong><span>${isSamsungInternet?'Use Chrome for a Play Protect-safe installation.':'Install it like an app for quick access and offline capture.'}</span></div><button class="btn btn-secondary" data-action="install-app">${isSamsungInternet?'Use Chrome':deferredInstallPrompt?'Install':'Show me how'}</button></section>` : ''}
    <div class="section-row"><h2>Today at a glance</h2><span class="offline-pill ${navigator.onLine?'':'offline'}">${storageLabel()}</span></div>
    <div class="quick-grid">
      <button class="quick-card" data-screen="activity" data-filter="tasks"><span class="quick-icon">${icon('list')}</span><div><strong>${pending.filter(t=>new Date(t.due)<=new Date(iso(0,23,59))).length} follow-ups</strong><span>need attention today</span></div></button>
      <button class="quick-card" data-screen="activity"><span class="quick-icon">${icon('map')}</span><div><strong>${todayVisits.length} visits</strong><span>${todayVisits.reduce((sum,v)=>sum+(new Date(v.end)-new Date(v.start)),0)/60000 || 0} minutes in trade</span></div></button>
      <button class="quick-card" data-screen="products"><span class="quick-icon">${icon('tag')}</span><div><strong>Price list</strong><span>${data.products.filter(p=>p.active).length} active products</span></div></button>
      <button class="quick-card" data-screen="reports"><span class="quick-icon">${icon('chart')}</span><div><strong>Reports</strong><span>daily, weekly & monthly</span></div></button>
      <button class="quick-card" data-screen="travel"><span class="quick-icon">${icon('pin')}</span><div><strong>${todayKm.toFixed(1)} km</strong><span>${currency(reimbursement(todayKm))} reimbursement today</span></div></button>
      <button class="quick-card" data-action="locate-customers"><span class="quick-icon">${icon('map')}</span><div><strong>Clients near me</strong><span>pinpoint the closest venue</span></div></button>
    </div>
    <div class="section-row"><h2>Next up</h2><button class="text-btn" data-screen="activity" data-filter="tasks">See all</button></div>
    <div class="list">${pending.slice(0,3).map(taskCard).join('') || emptyState('check','Nothing due','You are completely caught up.')}</div>
  </main>${nav()}`;
}

function taskCard(t) {
  const c = customer(t.customerId); const overdue = !t.done && new Date(t.due) < new Date(new Date().setHours(0,0,0,0));
  return `<article class="card task-card ${t.done?'done':''}"><button class="check ${t.done?'done':''}" data-action="toggle-task" data-id="${t.id}" aria-label="${t.done?'Reopen':'Complete'} task">${t.done?icon('check'):''}</button><div class="list-card-main"><h3>${esc(t.title)}</h3><p>${esc(c?.name)} · ${dayLabel(t.due)} at ${time(t.due)}</p></div><div class="date-chip ${overdue?'overdue':''}">${overdue?'Overdue':dayLabel(t.due)}</div></article>`;
}

function customersView() {
  const position = data.travel.lastPosition;
  const customerTypes = ['All', ...new Set(data.customers.map(c=>c.type).filter(Boolean))];
  const filtered = data.customers.filter(c => `${c.name} ${c.area} ${c.contact}`.toLowerCase().includes(query.toLowerCase()) && (filter==='All'||c.type===filter)).sort((a,b)=>position?geoDistanceKm(position,{lat:a.lat,lng:a.lng})-geoDistanceKm(position,{lat:b.lat,lng:b.lng}):0);
  return `${topbar('Customers','Your territory')}<main class="content"><div class="customer-actions"><button class="btn btn-primary" data-action="add-customer">${icon('plus')} Add client</button><button class="btn btn-secondary" data-action="locate-customers">${icon('pin')} ${position?'Refresh location':'Clients near me'}</button></div>${position?`<div class="location-state">${icon('check')}<span>Location captured ${time(position.capturedAt)}. Pinned customers are sorted by distance.</span></div>`:''}<div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search venue or contact" aria-label="Search customers"></div><div class="filter-row">${customerTypes.map(x=>`<button class="filter-chip ${filter===x?'active':''}" data-action="filter" data-value="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="list">${filtered.map((c,index)=>{const km=position?geoDistanceKm(position,{lat:c.lat,lng:c.lng}):null;const pinned=hasCustomerLocation(c);return `<article class="card customer-card" data-action="customer" data-id="${c.id}" tabindex="0"><div class="customer-top"><div class="dot-icon">${initials(c.name)}</div><div class="list-card-main"><h3>${esc(c.name)}</h3><p>${esc(c.area||'Area not added')} · ${esc(c.type)}</p></div>${icon('arrow')}</div><div class="customer-meta"><span>${position?`${index===0&&pinned?'Nearest · ':''}${distanceLabel(km)}${Number.isFinite(km)?' away':''}`:`${c.lastVisit?`Last visit ${dayLabel(c.lastVisit)}`:'Never visited'}`}</span><span>${currency(c.value||0)} opportunity</span></div></article>`}).join('') || emptyState('search','No matches','Try a different customer, contact or filter.')}</div></main>${nav()}`;
}

function activityView() {
  const mode = filter === 'tasks' ? 'tasks' : 'visits';
  const visits = [...data.visits].sort((a,b)=>new Date(b.start)-new Date(a.start)).filter(v => `${customer(v.customerId)?.name} ${v.summary} ${v.products.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return `${topbar('Activity','Your field record')}<main class="content"><div class="filter-row"><button class="filter-chip ${mode==='visits'?'active':''}" data-action="activity-mode" data-value="visits">Visit history</button><button class="filter-chip ${mode==='tasks'?'active':''}" data-action="activity-mode" data-value="tasks">Follow-ups</button><button class="filter-chip" data-screen="reports">Reports</button></div>
  ${mode==='visits' ? `<div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search visits, notes or products"></div><div class="timeline">${visits.map(v=>{const c=customer(v.customerId);return `<article class="card timeline-item" data-action="customer" data-id="${c?.id}"><span class="timeline-time">${dayLabel(v.start)} · ${time(v.start)} · ${duration(v.start,v.end)}</span><h3>${esc(c?.name)}</h3><p>${esc(v.summary)}</p><div style="margin-top:10px"><span class="status ${v.outcome?.includes('agreed')?'good':''}">${esc(v.outcome)}</span></div></article>`}).join('') || emptyState('clock','No visits found','Your completed visits will appear here.')}</div>` : `<div class="list">${[...data.tasks].sort((a,b)=>Number(a.done)-Number(b.done)||new Date(a.due)-new Date(b.due)).map(taskCard).join('')}</div><button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="add-task">${icon('plus')} Add follow-up</button>`}
  </main>${nav()}`;
}

function travelView() {
  const active = data.travel.activeTrip;
  const trips = [...data.travel.trips].sort((a,b)=>new Date(b.start)-new Date(a.start));
  const weekStart = new Date(now.getFullYear(),now.getMonth(),now.getDate()-6);
  const weekTrips = trips.filter(trip=>new Date(trip.start)>=weekStart);
  const todayKm = todayTrips().reduce((sum,trip)=>sum+trip.distanceKm,0);
  const weekKm = weekTrips.reduce((sum,trip)=>sum+trip.distanceKm,0);
  const closest = data.travel.lastPosition ? data.customers.filter(hasCustomerLocation).map(item=>({item,km:geoDistanceKm(data.travel.lastPosition,{lat:item.lat,lng:item.lng})})).sort((a,b)=>a.km-b.km).slice(0,3) : [];
  return `${topbar('Travel & mileage',`${currency(data.travel.ratePerKm)} per kilometre`)}<main class="content">
    ${active ? `<section class="card driving-card"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">GPS route recording</span></div><div class="travel-live"><div><strong data-trip-distance>${currentTripKm().toFixed(1)} km</strong><span>Distance</span></div><div><strong data-travel-timer>${duration(active.start)}</strong><span>Elapsed</span></div></div><p>${active.points.length} accepted GPS points · ${active.lastAccuracy?`±${Math.round(active.lastAccuracy)} m accuracy`:'waiting for location'}</p><button class="btn btn-danger btn-block" data-action="stop-travel">Stop driving & calculate</button></section>` : `<section class="card hero"><p class="eyebrow">GPS mileage tracker</p><h2>Track the drive. Claim the right amount.</h2><p>Start before you leave. FieldFlow will calculate the route and reimbursement at ${currency(data.travel.ratePerKm)}/km.</p><button class="btn btn-primary" data-action="start-travel">${icon('pin')} Start driving</button></section>`}
    <div class="section-row"><h2>Mileage summary</h2><span class="status">Rate ${currency(data.travel.ratePerKm)}/km</span></div>
    <div class="metric-grid"><div class="card metric"><span>Today</span><strong>${todayKm.toFixed(1)} km</strong></div><div class="card metric"><span>Today’s claim</span><strong>${currency(reimbursement(todayKm))}</strong></div><div class="card metric"><span>Last 7 days</span><strong>${weekKm.toFixed(1)} km</strong></div><div class="card metric"><span>7-day claim</span><strong>${currency(reimbursement(weekKm))}</strong></div></div>
    <div class="location-state">${icon('pin')}<span><strong>Location privacy:</strong> tracking starts only when you tap Start driving. Keep the PWA open during the trip; the native Android version can continue safely in the background.</span></div>
    <div class="section-row"><h2>Clients near me</h2><button class="text-btn" data-action="locate-customers">${data.travel.lastPosition?'Refresh':'Locate me'}</button></div>
    <div class="list">${closest.length?closest.map((entry,index)=>`<article class="card list-card" data-action="customer" data-id="${entry.item.id}"><div class="dot-icon">${index+1}</div><div class="list-card-main"><h3>${esc(entry.item.name)}</h3><p>${esc(entry.item.area)} · ${entry.km<1?`${Math.round(entry.km*1000)} m`:`${entry.km.toFixed(1)} km`} away</p></div>${icon('arrow')}</article>`).join(''):emptyState('pin','Location not captured','Tap Locate me to find the closest saved client.')}</div>
    <div class="section-row"><h2>Trip history</h2><span class="status">${trips.length} trips</span></div>
    <div class="list">${trips.length?trips.map(trip=>{const from=customer(trip.fromCustomerId);const to=customer(trip.toCustomerId);return `<article class="card trip-card"><div class="trip-route"><div class="route-dot"></div><div><span>${dayLabel(trip.start)} · ${time(trip.start)}</span><strong>${esc(from?.name||trip.fromLabel||'Start location')}</strong></div></div><div class="trip-line"></div><div class="trip-route"><div class="route-dot end"></div><div><span>${time(trip.end)}</span><strong>${esc(to?.name||trip.toLabel||'End location')}</strong></div></div><div class="trip-total"><span>${trip.distanceKm.toFixed(1)} km</span><strong>${currency(trip.reimbursement)}</strong></div></article>`}).join(''):emptyState('map','No trips recorded','Start driving to create your first mileage claim.')}</div>
  </main>${nav()}`;
}

function productsView() {
  const brands = [...new Set(data.products.map(p => p.brand))];
  const products = data.products.filter(p =>
    `${p.name} ${p.sku} ${p.brand} ${p.range} ${p.caseBarcode} ${p.unitBarcode}`.toLowerCase().includes(query.toLowerCase()) &&
    (productFilter === 'All' || p.brand === productFilter)
  );
  return `${topbar('Price list','Niew Beverages · On Con')}<main class="content"><div class="search">${icon('search')}<input id="search" value="${esc(query)}" placeholder="Search product, alias or barcode"></div><div class="filter-row"><button class="filter-chip ${productFilter==='All'?'active':''}" data-action="product-brand" data-value="All">All · ${data.products.length}</button>${brands.map(brand=>`<button class="filter-chip ${productFilter===brand?'active':''}" data-action="product-brand" data-value="${esc(brand)}">${esc(brand)} · ${data.products.filter(p=>p.brand===brand).length}</button>`).join('')}</div><div class="hero card" style="min-height:auto;margin-bottom:14px"><p class="eyebrow">On Con price list · 1 March 2026</p><h2 style="font-size:24px">${productFilter==='All'?'Complete portfolio':esc(productFilter)}</h2><p>${products.length} products shown. Case and unit prices include VAT.</p><div class="hero-actions"><button class="btn btn-primary" data-action="email-pricelist">${icon('mail')} Email this list</button><button class="btn btn-white" data-action="print-pricelist">Print</button></div></div><div class="list">${products.map(p=>`<article class="card product-card"><div class="product-head"><div><h3>${esc(p.name)}</h3><p>${esc(p.sku)} · ${esc(p.brand)} · ${esc(p.range)}</p></div>${p.availability==='Confirm availability'?'<span class="status hot">Confirm stock</span>':''}</div><div class="price-pair"><div><span>Case incl. VAT</span><strong>${currency(p.price)}</strong>${p.exCase!=null?`<small>${currency(p.exCase)} excl.</small>`:''}</div><div><span>Unit incl. VAT</span><strong>${p.unitPrice!=null?currency(p.unitPrice):'—'}</strong>${p.exUnit!=null?`<small>${currency(p.exUnit)} excl.</small>`:''}</div></div><div class="product-foot"><span class="status">${esc(p.pack)}</span><span style="font-size:11px;color:var(--muted)">${p.caseBarcode?`Case ${esc(p.caseBarcode)}`:'No barcode supplied'}</span></div></article>`).join('') || emptyState('search','No products found','Try another product, alias, barcode or supplier.')}</div></main>${nav()}`;
}

function reportsView() {
  const days = Array.from({length:7},(_,i)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()-6+i));
  const counts = days.map(d=>data.visits.filter(v=>new Date(v.start).toDateString()===d.toDateString()).length);
  const weekVisits = data.visits.filter(v=>new Date(v.start)>=days[0]);
  const customersSeen = new Set(weekVisits.map(v=>v.customerId)).size;
  const mins = weekVisits.reduce((n,v)=>n+(new Date(v.end)-new Date(v.start))/60000,0);
  const due = data.tasks.filter(t=>!t.done&&new Date(t.due)<=new Date(iso(0,23,59))).length;
  const discussed = [...new Set(weekVisits.flatMap(v=>v.products))];
  const weekTrips = data.travel.trips.filter(trip=>new Date(trip.start)>=days[0]);
  const weekKm = weekTrips.reduce((sum,trip)=>sum+trip.distanceKm,0);
  return `${topbar('Reports','Management snapshot')}<main class="content"><div class="filter-row"><button class="filter-chip">Daily</button><button class="filter-chip active">This week</button><button class="filter-chip">This month</button></div><div class="metric-grid"><div class="card metric"><span>Visits</span><strong>${weekVisits.length}</strong></div><div class="card metric"><span>Customers seen</span><strong>${customersSeen}</strong></div><div class="card metric"><span>Time in trade</span><strong>${Math.round(mins/60)}h</strong></div><div class="card metric"><span>Follow-ups due</span><strong>${due}</strong></div><div class="card metric"><span>Business travel</span><strong>${weekKm.toFixed(1)} km</strong></div><div class="card metric"><span>Mileage claim</span><strong>${currency(reimbursement(weekKm))}</strong></div></div><div class="section-row"><h2>Visit rhythm</h2><span class="status">Last 7 days</span></div><section class="card chart-card"><h3>Visits per day</h3><div class="bars">${days.map((d,i)=>`<div class="bar-col"><div class="bar" style="height:${Math.max(5,counts[i]*31)}%"></div><span>${d.toLocaleDateString('en-ZA',{weekday:'short'}).slice(0,2)}</span></div>`).join('')}</div></section><div class="section-row"><h2>Management notes</h2></div><div class="list"><div class="card insight">${icon('spark','icon-lg')}<p><strong>${customersSeen} customers reached.</strong> ${due?`${due} follow-ups need attention to protect momentum.`:'All committed follow-ups are on track.'}</p></div><div class="card info-card"><h3>Travel reimbursement</h3><div class="info-line" style="border:0;padding-top:0"><span>${weekKm.toFixed(1)} km at ${currency(data.travel.ratePerKm)}/km</span><strong>${currency(reimbursement(weekKm))}</strong></div></div><div class="card info-card"><h3>Products discussed</h3><p style="margin:0;color:var(--muted);line-height:1.7">${discussed.length?discussed.map(esc).join(' · '):'No products logged this week'}</p></div><div class="card info-card"><h3>Open opportunity value</h3><strong style="font-size:27px">${currency(data.customers.reduce((sum,c)=>sum+c.value,0))}</strong></div></div><button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="share-report">${icon('mail')} Email summary</button></main>${nav()}`;
}

function assistantView() {
  return `${topbar('Assistant','Your field co-pilot')}<main class="content"><section class="card assistant-hero"><div class="assistant-mark">${icon('spark','icon-lg')}</div><h2>What do you need?</h2><p>I can use your customers, visits, mileage and follow-ups to help plan the day.</p></section><div class="suggestions">${['Who needs follow-up?','What is my mileage claim?','Who have I not visited recently?','What happened at my last visit?','What should I do today?'].map(q=>`<button class="suggestion" data-action="ask" data-value="${esc(q)}">${esc(q)}</button>`).join('')}</div><div class="chat" id="chat">${data.chat.map(m=>`<div class="bubble ${m.role}">${esc(m.text)}</div>`).join('')}</div><form class="ask-row" id="ask-form"><input class="field" id="ask-input" maxlength="1000" placeholder="Ask about your day…" autocomplete="off"><button class="btn btn-primary send-btn" aria-label="Send">${icon('send')}</button></form></main>${nav()}`;
}

function visitView() {
  if (!data.activeVisit) { screen='home'; return homeView(); }
  const c = customer(data.activeVisit.customerId);
  const structured = structureNote(data.activeVisit.note || '');
  return `${topbar('Active visit','Capture while it’s fresh')}<main class="content"><section class="card active-visit"><div><span class="pulse"></span><span class="eyebrow" style="color:#d9f26a">At customer</span></div><div class="timer" data-timer>${duration(data.activeVisit.start)}</div><h2 style="margin:0 0 5px">${esc(c?.name)}</h2><p>${esc(c?.area)} · ${data.activeVisit.locationLabel||'location saved'}</p></section><div class="section-row"><h2>Visit note</h2><span class="status">Saved offline</span></div><section class="card note-box"><button class="voice-button" id="voice-button" data-action="voice" aria-label="Record voice note">${icon('mic','icon-lg')}</button><p class="voice-help" id="voice-help">Tap and speak naturally, or type below</p><label for="visit-note">What happened?</label><textarea class="field" id="visit-note" maxlength="4000" placeholder="Example: The buyer agreed to trial the new range. Send the price list tomorrow…">${esc(data.activeVisit.note||'')}</textarea>${data.activeVisit.note ? structuredPreview(structured) : ''}<button class="btn btn-secondary btn-block" style="margin-top:14px" data-action="structure-note">${icon('spark')} Structure my note</button></section><button class="btn btn-danger btn-block" style="margin-top:14px" data-action="end-visit">End visit & save</button></main>${nav()}`;
}

function structuredPreview(s) {
  return `<div class="structured"><div class="structured-item"><span>Summary</span><strong>${esc(s.summary)}</strong></div><div class="structured-item"><span>Products discussed</span><strong>${esc(s.products.join(', ')||'Not detected')}</strong></div><div class="structured-item"><span>Next action</span><strong>${esc(s.nextAction||'No action detected')}</strong></div><div class="structured-item"><span>Follow-up</span><strong>${esc(s.followUpLabel||'No date detected')}</strong></div></div>`;
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
  const outcomeSentence = sentences.find(s=>/agreed|interested|requested|confirmed|declined|trial|order/i.test(s));
  return { summary: sentences.slice(0,2).join('. ') || 'Visit completed', products, nextAction: action, followUp, followUpLabel, outcome: outcomeSentence ? outcomeSentence.slice(0,70) : 'Visit completed' };
}

function customerDetail(id) {
  const c=customer(id); if (!c) return;
  const visits=data.visits.filter(v=>v.customerId===id).sort((a,b)=>new Date(b.start)-new Date(a.start));
  modal=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(c.name)} details">
    <div class="handle"></div><div class="modal-head"><span></span><button class="close-btn" data-action="close-modal" aria-label="Close">${icon('x')}</button></div>
    <div class="card detail-banner"><span class="status good">${esc(c.type)}</span><h2>${esc(c.name)}</h2><p>${esc(c.area||'Area not added')} · ${c.lastVisit?`last visit ${dayLabel(c.lastVisit)}`:'never visited'}</p><div class="detail-actions"><button class="btn btn-primary" data-action="start-visit" data-id="${c.id}">${icon('plus')} Start visit</button><button class="btn btn-white" data-action="edit-customer" data-id="${c.id}">Edit details</button><a class="btn btn-white" style="text-decoration:none" href="mailto:${encodeURIComponent(c.email)}">${icon('mail')} Email</a><button class="btn btn-white" data-action="set-customer-location" data-id="${c.id}">${icon('pin')} Save this location</button></div></div>
    <div class="section-row"><h2>Contact</h2></div><div class="card info-card"><h3>${esc(c.contact||'No contact added')}</h3><p style="margin:-6px 0 12px;color:var(--muted)">${esc(c.role||'Role not added')}</p><div class="info-line"><span>Email</span><strong>${esc(c.email||'Not added')}</strong></div><div class="info-line"><span>Phone</span><strong>${esc(c.phone||'Not added')}</strong></div>${c.address?`<div class="info-line"><span>Address</span><strong>${esc(c.address)}</strong></div>`:''}</div>
    <div class="section-row"><h2>Saved location</h2></div><div class="card info-card">${hasCustomerLocation(c)?`<div class="info-line" style="border:0;padding-top:0"><span>Latitude</span><strong>${c.lat.toFixed(5)}</strong></div><div class="info-line"><span>Longitude</span><strong>${c.lng.toFixed(5)}</strong></div>`:`<p style="margin:0 0 14px;color:var(--muted);font-size:13px">No venue position saved yet. Pin it while you are at the client.</p>`}<button class="btn btn-secondary btn-block btn-small" data-action="set-customer-location" data-id="${c.id}">${icon('pin')} ${hasCustomerLocation(c)?'Update':'Save'} from this device</button></div>
    <div class="section-row"><h2>Opportunity</h2></div><div class="card info-card"><div class="info-line" style="border:0;padding-top:0"><span>${esc(c.opportunity)}</span><strong>${currency(c.value)}</strong></div></div>
    <div class="section-row"><h2>Recent visits</h2></div><div class="list">${visits.slice(0,3).map(v=>`<div class="card list-card"><div class="dot-icon">${icon('clock')}</div><div class="list-card-main"><h3>${dayLabel(v.start)} · ${duration(v.start,v.end)}</h3><p>${esc(v.summary)}</p></div></div>`).join('')||emptyState('clock','No visits yet','Start a visit to build the history.')}</div>
  </section></div>`;
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

function taskModal() {
  if (!data.customers.length) { customerFormModal(); toast('Add a client before creating a follow-up.'); return; }
  modal=`<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="task-form"><div class="handle"></div><div class="modal-head"><h2>New follow-up</h2><button type="button" class="close-btn" data-action="close-modal">${icon('x')}</button></div><div class="form-group"><label>Customer</label><select class="field" name="customerId">${data.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="form-group"><label>What needs to happen?</label><input class="field" name="title" maxlength="1000" required placeholder="Call buyer about trial order"></div><div class="form-group"><label>Due date</label><input class="field" name="due" type="date" required value="${iso(1).slice(0,10)}"></div><button class="btn btn-primary btn-block">Save follow-up</button></form></div>`; render();
}

function customerFormModal(customerId = null) {
  const existing = customerId ? customer(customerId) : null;
  const item = existing || { name:'', type:'Restaurant', area:'', address:'', contact:'', role:'', email:'', phone:'', opportunity:'', value:0, lat:null, lng:null };
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
    <label class="location-option"><input type="checkbox" name="useCurrentLocation"><span>${icon('pin')}<span><strong>${existing&&hasCustomerLocation(existing)?'Replace saved location':'Pin current device location'}</strong><small>${data.travel.lastPosition?'Use the most recently captured device position':'Use “Save this location” from the client profile when on site'}</small></span></span></label>
    <button class="btn btn-primary btn-block" type="submit">${existing?'Save changes':'Add client'}</button>
  </form></div>`;
  render();
}

function settingsModal() {
  const syncText = cloudState.error ? `Needs attention: ${cloudState.error}` : cloudState.syncing ? 'Syncing now…' : cloudState.lastSynced ? `Last synced ${time(cloudState.lastSynced)}` : 'Ready to sync';
  const installPanel = appInstalled ? `<div class="location-state">${icon('check')}<span>FieldFlow is installed on this device.</span></div>` : `<div class="card info-card"><h3>Install on this phone</h3><p style="margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5">${isSamsungInternet?'For this Samsung, install through Chrome to avoid the outdated package warning.':'Add FieldFlow to your Apps screen for full-screen access and safer offline use.'}</p><button class="btn btn-primary btn-block" data-action="install-app">${icon('download')} ${isSamsungInternet?'Open safely in Chrome':deferredInstallPrompt?'Install FieldFlow':'Show installation steps'}</button></div>`;
  const cloudPanel = !cloudState.configured
    ? `<div class="card info-card"><h3>Cloud backup</h3><p style="margin:0;color:var(--muted);font-size:13px;line-height:1.5">Cloud connection is not configured on this device. Local capture still works.</p></div>`
    : cloudState.signedIn
      ? `<div class="card info-card"><h3>Cloud backup is on</h3><div class="info-line"><span>Signed in as</span><strong>${esc(cloudState.email)}</strong></div><div class="info-line"><span>Status</span><strong>${esc(syncText)}</strong></div><div class="form-grid" style="margin-top:12px"><button class="btn btn-secondary" data-action="cloud-sync">Sync now</button><button class="btn btn-ghost" data-action="cloud-signout">Sign out</button></div></div>`
      : `<form class="card info-card" id="auth-form"><h3>Back up and sync</h3><p style="margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5">Pilot access is invitation-only. Sign in with the account created for you to keep customers, visits, follow-ups, products and mileage safely synced.</p><div class="form-group"><label>Email</label><input class="field" name="email" type="email" autocomplete="email" required maxlength="320" placeholder="you@example.com"></div><div class="form-group"><label>Password</label><input class="field" name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="Your password"></div><button class="btn btn-primary btn-block" type="submit">Sign in</button>${cloudState.error?`<p class="form-error">${esc(cloudState.error)}</p>`:''}</form>`;
  modal=`<div class="modal-backdrop" data-modal="settings" data-action="close-modal"><section class="modal"><div class="handle"></div><div class="modal-head"><h2>Profile & backup</h2><button class="close-btn" data-action="close-modal">${icon('x')}</button></div>${installPanel}<div class="card info-card"><h3>${esc(data.profile.name)}</h3><div class="info-line"><span>Territory</span><strong>${esc(data.profile.territory)}</strong></div><div class="info-line"><span>Local storage</span><strong>Always on</strong></div></div>${cloudPanel}<p style="color:var(--muted);font-size:13px;line-height:1.5">Field work saves to this device first. When signed in, it syncs securely as soon as a connection is available.</p><button class="btn btn-ghost btn-block" data-action="clear-crm-data">${icon('refresh')} Clear my CRM data</button></section></div>`; render();
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
  clearInterval(timerId);
  clearInterval(travelTimerId);
  const views={home:homeView,customers:customersView,activity:activityView,travel:travelView,products:productsView,reports:reportsView,assistant:assistantView,visit:visitView};
  document.getElementById('app').innerHTML=(views[screen]||homeView)()+(modal||'');
  if (data.activeVisit) timerId=setInterval(()=>document.querySelectorAll('[data-timer]').forEach(el=>el.textContent=duration(data.activeVisit.start)),1000);
  if (data.travel.activeTrip) {
    travelTimerId=setInterval(()=>document.querySelectorAll('[data-travel-timer]').forEach(el=>el.textContent=duration(data.travel.activeTrip.start)),1000);
    resumeTravelTracking();
  }
  if(screen==='assistant') setTimeout(()=>document.getElementById('chat')?.lastElementChild?.scrollIntoView({behavior:'smooth'}),50);
}

function answerQuestion(q) {
  const lower=q.toLowerCase(); const pending=data.tasks.filter(t=>!t.done).sort((a,b)=>new Date(a.due)-new Date(b.due));
  if (/mileage|kilomet|travel|reimburse|claim/.test(lower)) { const weekTrips=data.travel.trips.filter(t=>new Date(t.start)>new Date(Date.now()-7*DAY));const km=weekTrips.reduce((sum,t)=>sum+t.distanceKm,0);return `Your last 7 days total ${km.toFixed(1)} km. At ${currency(data.travel.ratePerKm)} per km, the reimbursement is ${currency(reimbursement(km))}.`; }
  if (/follow.?up|due|overdue/.test(lower)) return pending.length ? `You have ${pending.length} open follow-ups. Start with ${customer(pending[0].customerId)?.name}: ${pending[0].title.toLowerCase()} (${dayLabel(pending[0].due)}).` : 'You have no open follow-ups.';
  if (/not visited|recently|neglect/.test(lower)) { const sorted=[...data.customers].sort((a,b)=>new Date(a.lastVisit)-new Date(b.lastVisit)); if(!sorted.length)return 'Add your first client and I will track who has not been visited.'; return sorted.length===1?`${sorted[0].name} has ${sorted[0].lastVisit?`not been visited since ${dayLabel(sorted[0].lastVisit)}`:'not been visited yet'}.`:`${sorted[0].name} needs a visit most — last seen ${dayLabel(sorted[0].lastVisit)}. ${sorted[1].name} is next.`; }
  if (/today|prioriti|plan|do next/.test(lower)) { if(!data.customers.length)return 'Start by adding your first client. Then I can build your daily visit and follow-up plan.'; return pending.length ? `Today: 1) ${pending[0].title} for ${customer(pending[0].customerId)?.name}. 2) Visit ${[...data.customers].sort((a,b)=>new Date(a.lastVisit)-new Date(b.lastVisit))[0].name}. 3) Clear any new notes before you finish.` : 'Your follow-ups are clear. Prioritise the customer with the oldest visit date.'; }
  if (/last visit|what happened/.test(lower)) { const visit=[...data.visits].sort((a,b)=>new Date(b.start)-new Date(a.start))[0]; return visit?`Your last visit was to ${customer(visit.customerId)?.name||'a client'} on ${dayLabel(visit.start)}: ${visit.summary} Next action: ${visit.nextAction||'None recorded'}.`:'You have no recorded visits yet.'; }
  const named=data.customers.find(c=>lower.includes(c.name.toLowerCase())||lower.includes(c.name.split(' ')[0].toLowerCase()));
  if (named) { const visit=data.visits.filter(v=>v.customerId===named.id).sort((a,b)=>new Date(b.start)-new Date(a.start))[0]; return visit ? `Last visit to ${named.name} was ${dayLabel(visit.start)}: ${visit.summary} Next action: ${visit.nextAction}.` : `${named.name} has no recorded visits yet.`; }
  if (/product|discussed|range/.test(lower)) { const counts={}; data.visits.flatMap(v=>v.products).forEach(p=>counts[p]=(counts[p]||0)+1); const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]; return top?`${top[0]} is the most discussed product in your recorded visits (${top[1]} mentions).`:'No product discussions are recorded yet.'; }
  return 'I can help with follow-ups, customers not visited recently, last-visit notes, products discussed, and today’s priorities.';
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
    data.travel.activeTrip = { id:`trip${Date.now()}`, start:new Date().toISOString(), points:[point], fromCustomerId:nearest?.km<=.5?nearest.customer.id:null, fromLabel:nearest?.km<=.5?'':`GPS ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, lastAccuracy:point.accuracy };
    save(); screen='travel'; render(); resumeTravelTracking(); toast('Mileage tracking started');
  }, 'Allow precise location to record business travel.');
}

function stopTravelTracking() {
  const active = data.travel.activeTrip;
  if (!active) return;
  if (locationWatchId !== null) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId=null; }
  const last = active.points.at(-1) || data.travel.lastPosition;
  const nearest = last ? nearestCustomer(last) : null;
  const distanceKm = routeDistanceKm(active.points);
  data.travel.trips.push({ id:active.id, start:active.start, end:new Date().toISOString(), points:active.points, fromCustomerId:active.fromCustomerId, toCustomerId:nearest?.km<=.5?nearest.customer.id:null, fromLabel:active.fromLabel, toLabel:nearest?.km<=.5?'':last?`GPS ${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}`:'End location', distanceKm, ratePerKm:data.travel.ratePerKm, reimbursement:reimbursement(distanceKm) });
  data.travel.activeTrip=null; save(); render(); toast(`${distanceKm.toFixed(1)} km saved · ${currency(reimbursement(distanceKm))} claim`);
}

document.addEventListener('click', async event => {
  const target=event.target.closest('[data-screen],[data-action]'); if(!target)return;
  if(target.dataset.screen){screen=target.dataset.screen; if(target.dataset.filter)filter=target.dataset.filter; else if(screen!=='customers')filter='All'; query=''; modal=null; render(); return;}
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
    const finish=(coords,label)=>{if(data.travel.activeTrip)stopTravelTracking();const point=coords?{lat:coords.latitude,lng:coords.longitude,accuracy:coords.accuracy,capturedAt:new Date().toISOString()}:null;if(point)data.travel.lastPosition=point;const firstPin=point&&!hasCustomerLocation(c);if(firstPin){c.lat=point.lat;c.lng=point.lng;}const venueDistance=point?geoDistanceKm(point,{lat:c.lat,lng:c.lng}):Infinity;const locationLabel=firstPin?'Venue pinned from first visit':point?`${label} · ${distanceLabel(venueDistance)} from venue`:label;data.activeVisit={id:`v${Date.now()}`,customerId:c.id,start:new Date().toISOString(),lat:point?.lat??c.lat,lng:point?.lng??c.lng,locationLabel,note:''};save();modal=null;screen='visit';render();toast(firstPin?'Visit started and client location pinned':'Visit started and location saved');};
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>finish(p.coords,'Live location captured'),()=>finish(null,'Venue location used'),{enableHighAccuracy:true,timeout:6000,maximumAge:60000}); else finish(null,'Venue location used');
  }
  else if(action==='customer')customerDetail(target.dataset.id);
  else if(action==='add-customer')customerFormModal();
  else if(action==='edit-customer')customerFormModal(target.dataset.id);
  else if(action==='filter'){filter=target.dataset.value;render();}
  else if(action==='product-brand'){productFilter=target.dataset.value;query='';render();}
  else if(action==='activity-mode'){filter=target.dataset.value==='tasks'?'tasks':'All';query='';render();}
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
  else if(action==='toggle-task'){const t=data.tasks.find(x=>x.id===target.dataset.id);t.done=!t.done;save();render();toast(t.done?'Follow-up completed':'Follow-up reopened');}
  else if(action==='add-task')taskModal();
  else if(action==='voice')startVoiceCapture();
  else if(action==='structure-note'){const box=document.getElementById('visit-note');data.activeVisit.note=box.value;save();render();toast('Note structured — check the suggested fields');}
  else if(action==='end-visit'){
    const note=document.getElementById('visit-note')?.value||data.activeVisit.note||''; const s=structureNote(note); const active=data.activeVisit; const c=customer(active.customerId);
    data.visits.push({id:active.id,customerId:active.customerId,start:active.start,end:new Date().toISOString(),lat:active.lat,lng:active.lng,summary:s.summary,products:s.products,outcome:s.outcome,nextAction:s.nextAction||'Review visit note',followUp:s.followUp,source:'voice'});
    c.lastVisit=active.start;
    if(s.nextAction) data.tasks.push({id:`t${Date.now()}`,customerId:c.id,title:s.nextAction,due:s.followUp||iso(1,9),done:false,priority:'Next'});
    data.activeVisit=null;save();screen='home';render();toast('Visit saved. Follow-up added.');
  }
  else if(action==='ask')ask(target.dataset.value);
  else if(action==='email-pricelist')emailPriceList();
  else if(action==='print-pricelist')window.print();
  else if(action==='share-report')emailReport();
  else if(action==='cloud-sync'){target.disabled=true;await syncCloudNow(true);settingsModal();toast(cloudState.error?'Sync needs attention':'Cloud backup is up to date');}
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
  else if(action==='clear-crm-data'){if(!confirm('Clear all customers, visits, follow-ups and mileage? This also clears them from cloud backup and cannot be undone.'))return;const profile=clone(data.profile);const products=clone(data.products?.length?data.products:realProducts);data=clone(seed);data.profile=profile;data.products=products;save();modal=null;screen='home';render();toast('CRM activity cleared. Your real price list remains.');}
});

document.addEventListener('input', event => {
  if(event.target.id==='search'){query=event.target.value; const pos=event.target.selectionStart;render();const input=document.getElementById('search');input?.focus();input?.setSelectionRange(pos,pos);}
  if(event.target.id==='visit-note'&&data.activeVisit){data.activeVisit.note=event.target.value;save();}
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  if(event.target.id==='ask-form'){const input=document.getElementById('ask-input');ask(input.value);}
  if(event.target.id==='auth-form'){
    const fd=new FormData(event.target);const email=String(fd.get('email')||'').trim();const password=String(fd.get('password')||'');
    [...event.target.querySelectorAll('button')].forEach(button=>button.disabled=true);
    try{await signInWithEmail(email,password);toast('Signed in. Your cloud data is loading.');}catch(error){toast(error.message);settingsModal();}
  }
  if(event.target.id==='task-form'){const fd=new FormData(event.target);data.tasks.push({id:`t${Date.now()}`,customerId:fd.get('customerId'),title:fd.get('title'),due:new Date(`${fd.get('due')}T09:00:00`).toISOString(),done:false,priority:'Next'});save();modal=null;render();toast('Follow-up added');}
  if(event.target.id==='customer-form'){
    const fd=new FormData(event.target); const id=event.target.dataset.id; const existing=id?customer(id):null; const useCurrent=fd.get('useCurrentLocation')==='on'&&data.travel.lastPosition;
    const values={name:String(fd.get('name')).trim(),type:String(fd.get('type')),area:String(fd.get('area')).trim(),address:String(fd.get('address')).trim(),contact:String(fd.get('contact')).trim(),role:String(fd.get('role')).trim(),email:String(fd.get('email')).trim(),phone:String(fd.get('phone')).trim(),opportunity:String(fd.get('opportunity')).trim(),value:Number(fd.get('value'))||0};
    if(existing){Object.assign(existing,values);if(useCurrent){existing.lat=data.travel.lastPosition.lat;existing.lng=data.travel.lastPosition.lng;}}
    else {data.customers.push({id:`c${Date.now()}`,...values,lastVisit:null,lat:useCurrent?data.travel.lastPosition.lat:null,lng:useCurrent?data.travel.lastPosition.lng:null});}
    save();modal=null;screen='customers';filter='All';query='';render();toast(existing?'Client details updated':'New client added');
  }
});

function startVoiceCapture(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition; const button=document.getElementById('voice-button'); const help=document.getElementById('voice-help');
  if(!Recognition){help.textContent='Voice capture is not available in this browser. Type your note below.';document.getElementById('visit-note')?.focus();return;}
  const recognition=new Recognition();recognition.lang='en-ZA';recognition.interimResults=true;button.classList.add('listening');help.textContent='Listening… tap stop on your keyboard if needed';
  recognition.onresult=e=>{const transcript=Array.from(e.results).map(r=>r[0].transcript).join(' ');const limited=transcript.slice(0,4000);const box=document.getElementById('visit-note');box.value=limited;data.activeVisit.note=limited;save();if(transcript.length>limited.length)help.textContent='The note reached its 4,000-character safety limit.';};
  recognition.onerror=()=>{help.textContent='I could not hear that. Try again or type your note.';};
  recognition.onend=()=>{button.classList.remove('listening');help.textContent='Captured. Tap “Structure my note” to review it.';};recognition.start();
}

function selectedProducts(){return data.products.filter(p=>p.active&&(productFilter==='All'||p.brand===productFilter));}
function priceListText(){return selectedProducts().map(p=>`${p.sku} · ${p.name} (${p.pack}) — case ${currency(p.price)}${p.unitPrice!=null?`, unit ${currency(p.unitPrice)}`:''} incl. VAT`).join('\n');}
function emailPriceList(){const listName=productFilter==='All'?'Complete portfolio':productFilter;const subject=`Niew Beverages On Con price list — ${listName}`;const body=`Hi,\n\nPlease find the Niew Beverages On Con pricing effective 1 March 2026 below. Prices include VAT.\n\n${priceListText()}\n\nPlease let me know if you would like to place an order or confirm availability.\n\nRegards,\n${data.profile.name}`;window.location.href=`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;}
function emailReport(){const visits=data.visits.filter(v=>new Date(v.start)>new Date(Date.now()-7*DAY));const trips=data.travel.trips.filter(t=>new Date(t.start)>new Date(Date.now()-7*DAY));const km=trips.reduce((sum,t)=>sum+t.distanceKm,0);const mins=visits.reduce((n,v)=>n+(new Date(v.end)-new Date(v.start))/60000,0);const body=`Weekly field activity\n\nVisits: ${visits.length}\nCustomers seen: ${new Set(visits.map(v=>v.customerId)).size}\nTime in trade: ${Math.round(mins/60)} hours\nOpen follow-ups: ${data.tasks.filter(t=>!t.done).length}\nBusiness travel: ${km.toFixed(1)} km\nMileage rate: ${currency(data.travel.ratePerKm)} per km\nReimbursement claim: ${currency(reimbursement(km))}\nOpen opportunity value: ${currency(data.customers.reduce((s,c)=>s+c.value,0))}`;window.location.href=`mailto:?subject=${encodeURIComponent('Weekly field sales activity and mileage')}&body=${encodeURIComponent(body)}`;}

window.addEventListener('online',()=>{render();syncCloudNow(false);});window.addEventListener('offline',render);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=isSamsungInternet?null:event;if(screen==='home'||modal?.includes('data-modal="settings"'))render();});
window.addEventListener('appinstalled',()=>{appInstalled=true;deferredInstallPrompt=null;modal=null;render();toast('FieldFlow is installed and ready.');});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').then(registration=>registration.update()).catch(()=>{}));
render();
initializeCloud({
  getData:()=>data,
  setData:remote=>{data={...data,...remote};persistLocal();screen=data.activeVisit?'visit':'home';modal=null;render();toast('Cloud data is ready on this device.');},
  onIdentityChange:user=>activateWorkspace(user),
  onStatus:next=>{cloudState=next;if(screen==='home'||modal?.includes('data-modal="settings"'))render();}
});
