const clean = value => String(value ?? '').trim();
const line = value => clean(value).replace(/[\r\n]+/g, ' ');
const unique = values => [...new Set(values.map(clean).filter(Boolean))];
export function validContactEmail(value) {
  return /^[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(clean(value))
    && !/[\r\n,;]/.test(value) && clean(value).length <= 254;
}
function dateLabel(value) {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value+'T12:00:00' : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}) : '';
}
export function buildEmailFollowUp({customer,visit=null,products=[],relationships=[],profile={},task=null,now=new Date()}) {
  if (!customer) throw new Error('This client is no longer available.');
  const snapshot=visit?.contactSnapshot||{};
  const to=clean(customer.email || snapshot.email);
  if (!to) throw new Error('No email address saved for this contact.');
  if (!validContactEmail(to)) throw new Error('Please correct the saved email address for this contact.');
  const person=line(customer.email ? (customer.contact || snapshot.person) : (snapshot.person || customer.contact));
  const first=person.split(/\s+/)[0];
  const venue=line(snapshot.placeName || customer.name);
  const names=ids=>unique(ids.map(id=>products.find(p=>p.id===id)?.name));
  const outcomes=visit?.wineOutcomes||[];
  const discussed=unique([...names(outcomes.map(o=>o.wineId)),...(visit?.products||[])]);
  const interested=names(outcomes.filter(o=>['Interested','Considering'].includes(o.outcome)).map(o=>o.wineId));
  const samples=names([...(visit?.samplesLeftWineIds||[]),...outcomes.filter(o=>o.sampleLeft).map(o=>o.wineId)]);
  const listed=names([...(visit?.currentWineIds||[]),...relationships.filter(r=>r.customerId===customer.id&&r.status==='Listed').map(r=>r.wineId)]);
  const outcome=visit?.feedbackOutcome||visit?.outcome||'';
  const noWindow=/not doing listings|no current listing opportunity/i.test(outcome);
  const visitDate=dateLabel(visit?.start);
  const today=visitDate&&visitDate===dateLabel(now.toISOString());
  const intro=visitDate
    ? 'Thank you for taking the time to see me '+(today?'today':'on '+visitDate)+' at '+venue+'.'
    : 'I hope you are well. I am following up with you at '+venue+'.';
  const parts=['Hi'+(first?' '+first:'')+',',intro];
  if (noWindow) parts.push('I understand that you are not reviewing new listings at the moment. Thank you for your time; I will stay in touch for a suitable opportunity.');
  else if (listed.length) parts.push('Thank you for your continued support of our wines. I am following up on our discussion.');
  const section=(title,items)=>{if(items.length)parts.push(title+':\n'+items.map(v=>'- '+line(v)).join('\n'));};
  section('Wines discussed',discussed);
  section('Wines of interest',interested);
  section('Currently listed',listed);
  section('Samples left',samples);
  // Do not copy private CRM notes or infer promises from "sampled"/"sample left".
  const recordedPromises=clean(visit?.rawNote||visit?.note).split(/(?:[.!?]\s+|\n)/)
    .filter(text=>/^(?:(?:I|We) (?:will|promised|agreed to)|Promised|Agreed to|Will (?:bring|send|deliver|arrange))\b/i.test(text.trim())
      && /\bsamples?\b/i.test(text) && !/\b(?:no|not|never)\b|n['’]t\b/i.test(text));
  const samplePromises=clean(visit?.samplesPromised)||recordedPromises.join('\n');
  if(samplePromises)parts.push('Samples promised:\n'+samplePromises);
  const next=clean(visit?.nextAction || task?.reason || visit?.followUpReason);
  if(next)parts.push('Next step:\n'+next);
  const followDate=!(task?.done||visit?.followUpCompleted) ? dateLabel(task?.due||visit?.followUp||visit?.followUpAt) : '';
  if(followDate) {
    const past=new Date((task?.due||visit?.followUp||visit?.followUpAt).slice(0,10)+'T23:59:59')<now;
    parts.push(past?'Our recorded follow-up date was '+followDate+'. I am getting back in touch now.':'I will be back in touch on '+followDate+'.');
  }
  parts.push('Kind regards,\n'+line(profile.name||'Ernest Reyneke')+'\nNamaqua Wines');
  const subject='Namaqua Wines Follow-up - '+venue;
  const body=parts.join('\n\n');
  return {to,subject,body,customerId:customer.id,visitId:visit?.id||null,contactPerson:person,venue};
}
export function followUpMailto(draft) {
  if(!validContactEmail(draft.to))throw new Error('Please correct the saved email address for this contact.');
  return 'mailto:'+encodeURIComponent(clean(draft.to))+'?subject='+encodeURIComponent(line(draft.subject))+'&body='+encodeURIComponent(draft.body.replace(/\r?\n/g,'\r\n'));
}
export function markEmailFollowUpSent(workspace,draft,at=new Date().toISOString()) {
  const customer=workspace.customers.find(c=>c.id===draft?.customerId);
  if(!customer||!draft?.id||!validContactEmail(draft.to))throw new Error('The email draft or client is no longer available.');
  const history=Array.isArray(customer.emailFollowUps)?customer.emailFollowUps:[];
  const existing=history.find(e=>e.id===draft.id);
  if(existing)return existing;
  if(history.length>=1000)throw new Error('This client has reached the email-history limit. Export a backup before arranging an archive.');
  const event={id:draft.id,emailMarkedSent:true,markedAt:at,customerId:customer.id,venue:line(draft.venue).slice(0,160),visitId:draft.visitId||null,contactPerson:line(draft.contactPerson).slice(0,120),to:draft.to,subject:line(draft.subject).slice(0,256)};
  customer.emailFollowUps=[...history,event];
  return event;
}
