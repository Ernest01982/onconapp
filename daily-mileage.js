import {roundDecimal} from './sync-safety.js';
export const businessDate = (value=new Date()) => Number.isFinite(+new Date(value))?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
export const isDaily = trip => Boolean(trip?.dailyLog?.date);
export function claimTrips(trips) {
  // Resolve the whole collection before date/client filtering. Supporting trips
  // remain stored, but cannot inflate a day already covered by an odometer log.
  const days=new Map();
  for(const t of trips)if(isDaily(t)&&!days.has(t.dailyLog.date))days.set(t.dailyLog.date,t);
  return trips.filter(t=>isDaily(t)?days.get(t.dailyLog.date)===t:!days.has(businessDate(t.start)));
}
export function validateDay(date,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+new Date(date))||new Date(date).toISOString().slice(0,10)!==date||date>businessDate(now))throw Error('Choose a valid date, not in the future.');
 return date;
}
export function reading(value,label){
 if(value==null||String(value).trim()==='')throw Error('Enter '+label+'.');
 const n=Number(value);
 if(!Number.isFinite(n)||n<0||n>10000000||Math.abs(n*10-Math.round(n*10))>0.000001)throw Error(label+' must be a positive number or zero, with at most one decimal.');
 return n;
}
export function finishDay(active,values,now=new Date()){
 const date=validateDay(active.dailyLog.date,now),start=reading(values.startOdometer,'start odometer'),end=reading(values.endOdometer,'end odometer'),privateKm=reading(values.privateKm,'private KM');
 const total=roundDecimal(end-start,1);
 if(total<0)throw Error('End odometer cannot be less than start odometer.');
 if(privateKm>total)throw Error('Private KM cannot exceed the total distance.');
 if(total>5000)throw Error('More than 5,000 km in one day: check the readings.');
 const purpose=String(values.purpose||'').trim();if(!purpose)throw Error('Enter the business purpose or area covered.');
 const distanceKm=roundDecimal(total-privateKm,1),ratePerKm=Number(active.ratePerKm);
 if(!Number.isFinite(ratePerKm)||ratePerKm<0)throw Error('Check the reimbursement rate.');
 return {...active,id:'day-'+date,start:date+'T00:00:00+02:00',end:date+'T23:59:59+02:00',points:[],customerId:null,fromCustomerId:null,toCustomerId:null,fromLabel:String(values.fromLabel||'').trim()||'Start of day',toLabel:String(values.toLabel||'').trim()||'End of day',purpose,startOdometer:start,endOdometer:end,distanceSource:'odometer',distanceKm,ratePerKm,reimbursement:roundDecimal(distanceKm*ratePerKm,2),notes:String(values.notes||'').trim(),dailyLog:{date,privateKm,totalKm:total,finishedAt:now.toISOString()},recordingFlags:[]};
}
export function navigationUrl(client){
 if(!client)return null;
 const pin=client.lat!=null&&client.lng!=null&&client.lat!==''&&client.lng!==''&&Number.isFinite(Number(client.lat))&&Number.isFinite(Number(client.lng))&&Math.abs(Number(client.lat))<=90&&Math.abs(Number(client.lng))<=180;
 const destination=pin?client.lat+','+client.lng:[client.name,client.address,client.area,'South Africa'].filter(Boolean).join(', ');
 if(!pin&&!String(client.address||client.area||'').trim())return null;
 const url=new URL('https://www.google.com/maps/dir/');url.search=new URLSearchParams({api:'1',destination,travelmode:'driving',dir_action:'navigate'}).toString();return url.href;
}
