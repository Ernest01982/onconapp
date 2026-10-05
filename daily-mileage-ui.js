import {businessDate,isDaily,claimTrips} from './daily-mileage.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayPanel(travel){
 const active=isDaily(travel.activeTrip)?travel.activeTrip:null;
 const today=travel.trips.find(t=>t.dailyLog?.date===businessDate());
 return '<section class="card info-card day-mileage"><h2>Daily odometer</h2>'+
 (active?'<p>Day open: <strong>'+esc(active.dailyLog.date)+'</strong> · Start '+active.startOdometer.toFixed(1)+' km</p><p>No background GPS needed. Enter the end reading for this date, even if you finish the log later.</p><button class="btn btn-primary btn-block" data-action="finish-day">Finish day</button>':
 today?'<p>Today: <strong>'+today.distanceKm.toFixed(1)+' business km</strong> · R'+today.reimbursement.toFixed(2)+'</p><button class="btn btn-secondary btn-block" data-action="edit-trip" data-id="'+esc(today.id)+'">Review / edit today</button><button class="text-btn" data-action="start-day">Add a previous day</button>':
 '<p>Start with your odometer. Finish with the end reading and subtract private travel.</p><button class="btn btn-primary btn-block" data-action="start-day">Start day</button>')+
 '<p class="field-help">A completed daily log replaces individual trips in that date’s totals, without deleting them. Daily KM is not allocated to individual clients. Always exclude non-business travel.</p></section>';
}
export function dayForm(item,finishing=false,editing=false){
 const input=(label,name,value,type='text',extra='')=>'<div class="form-group"><label>'+label+'</label><input class="field" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></div>';
 const numeric='min="0" max="10000000" step="0.1" inputmode="decimal" required';
 return '<div class="modal-backdrop" data-action="close-modal"><form class="modal" id="day-form" data-edit="'+(editing?'yes':'no')+'" data-finishing="'+(finishing?'yes':'no')+'"><div class="modal-head"><h2>'+(finishing?'Finish / edit day':'Start day')+'</h2><button type="button" class="close-btn" data-action="close-modal">×</button></div>'+
 '<p class="modal-hint">One log for the whole business day. Use readings for the chosen date—not today’s reading for a previous day.</p>'+
 input('Date (South African time)','date',item.dailyLog?.date||businessDate(),'date','required max="'+businessDate()+'" '+(finishing?'readonly':''))+
 input('Start odometer','startOdometer',item.startOdometer??'','number',numeric)+
 (finishing?input('End odometer','endOdometer',item.endOdometer??'','number',numeric)+input('Private / non-business KM','privateKm',item.dailyLog?.privateKm??0,'number',numeric):'')+
 input('Starting location','fromLabel',item.fromLabel||'','text','maxlength="500"')+
 (finishing?input('Ending location','toLabel',item.toLabel||'','text','maxlength="500"'):'')+
 input('Business purpose / area covered','purpose',item.purpose||'Customer visits','text','required maxlength="500"')+
 '<div class="form-group"><label>Notes</label><textarea class="field" name="notes" maxlength="4000">'+esc(item.notes||'')+'</textarea></div>'+
 '<p class="field-help">Saved rate: R'+Number(item.ratePerKm).toFixed(2)+'/km. '+(finishing?'Business KM = end − start − private KM. You will confirm the calculated total before saving.':'No location permission is needed.')+'</p>'+
 '<button class="btn btn-primary btn-block" type="submit">'+(finishing?'Calculate & save day':'Save start reading')+'</button></form></div>';
}
export function supportingTrips(trips){
 const counted=new Set(claimTrips(trips).map(t=>t.id));return trips.filter(t=>!counted.has(t.id));
}
