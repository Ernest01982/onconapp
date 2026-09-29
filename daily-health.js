export function visitNeedsReview(visit, now = new Date()) {
  const start=new Date(visit.start),end=new Date(visit.end||now);
  return Number.isFinite(+start)&&Number.isFinite(+end)&&(end-start>4*3600000 || start.toDateString()!==end.toDateString());
}

export function correctVisitTime(visit,{start,end,reason,actor},now=new Date()) {
  const from=new Date(start),to=new Date(end);
  if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<from)throw new Error('End time must be on or after the start time.');
  if(+from===+new Date(visit.start)&&+to===+new Date(visit.end))return visit;
  if(to>now)throw new Error('A completed visit cannot end in the future.');
  if(!String(reason||'').trim())throw new Error('Add a reason for correcting the visit times.');
  if((visit.timeCorrections||[]).length>=100)throw new Error('Correction history is full. Export a backup before arranging an archive.');
  return {...visit,start:from.toISOString(),end:to.toISOString(),timeCorrections:[...(visit.timeCorrections||[]),{at:now.toISOString(),actor:String(actor||'Rep').slice(0,120),reason:String(reason).trim().slice(0,1000),before:{start:visit.start,end:visit.end},after:{start:from.toISOString(),end:to.toISOString()}}]};
}

export function dailyHealth(workspace, now = new Date()) {
  const day=new Date(now);day.setHours(0,0,0,0);
  const end=new Date(day);end.setDate(end.getDate()+1);
  return {
    longVisits:(workspace.visits||[]).filter(v=>visitNeedsReview(v,now)),
    overdue:(workspace.tasks||[]).filter(t=>!t.done&&new Date(t.due)<day),
    today:(workspace.tasks||[]).filter(t=>!t.done&&new Date(t.due)>=day&&new Date(t.due)<end),
    missingContact:(workspace.customers||[]).filter(c=>![c.phone,c.email,c.additionalPhone,c.additionalEmail].some(v=>String(v||'').trim())),
    missingCycle:(workspace.customers||[]).filter(c=>![c.menuChangeDate,c.menuChangeMonth,c.listingsReopenAt,c.listingsReopenMonth].some(Boolean)),
    flaggedTrips:(workspace.travel?.trips||[]).filter(t=>t.recordingFlags?.length&&t.distanceSource==='gps')
  };
}

export function contactFor(customer,kind='primary') {
  if(!customer)return null;
  if(kind!=='additional')return {...customer};
  return {...customer,contact:customer.additionalContact||'',phone:customer.additionalPhone||'',email:customer.additionalEmail||'',role:''};
}

// Quoting alone doesn't prevent formulas when the CSV is opened in Excel.
export const safeCsvCell = value => {
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export const csvDocument = rows => '\uFEFF'+rows.map(row=>row.map(safeCsvCell).join(',')).join('\r\n');
