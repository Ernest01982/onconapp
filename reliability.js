// Small, deterministic helpers. No AI service and no automatic placement decisions.
export function savedReimbursement(trips) {
  return trips.reduce((sum, trip) => sum + (Number(trip.reimbursement) || 0), 0);
}

const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function questionScope(question, customers) {
  const text = ` ${normalized(question)} `;
  const matches = customers.filter(c => normalized(c.name) && text.includes(` ${normalized(c.name)} `));
  if (matches.length > 1) return { clarification:'Please ask about one client at a time, using their full saved name.' };
  if (matches.length === 1) return { customer:matches[0] };
  if (/\blast visit\s+(?:to|at|with)\s+\S|\bwhat happened\s+(?:at|with)\s+(?!my\b|the\b)\S/i.test(question)) return { clarification:'I could not identify that client. Please use their full saved name so I do not show another client’s visit.' };
  return {};
}

export function draftVisitNote(note, catalogue, visit = {}) {
  const clean = String(note || '').trim().replace(/\s+/g, ' ');
  const sentences = clean.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const selected = (visit.wineOutcomes || []).map(item => catalogue.find(p => p.id === item.wineId)?.name).filter(Boolean);
  const detected = catalogue.filter(p => clean.toLowerCase().includes(p.name.toLowerCase())).map(p => p.name);
  const hasNegation = sentence => /\b(?:no|not|never|cannot|can't|won't|don't|didn't|hasn't|isn't|aren't|without|declined)\b/i.test(sentence);
  const action = sentences.find(s => !hasNegation(s) && /\b(?:send|call|email|drop|confirm|book|prepare|follow up)\b/i.test(s)) || '';
  // Dates, outcomes and commitments must come from explicitly chosen fields.
  // A rule-based parser cannot reliably distinguish speculation, negation or whose promise it is.
  return {
    summary:sentences.slice(0,2).join('. ') || 'Visit completed',
    products:[...new Set([...selected, ...detected])],
    nextAction:visit.nextAction || action,
    followUp:visit.followUpRequired ? visit.followUpAt || null : null,
    followUpLabel:visit.followUpRequired && visit.followUpAt ? visit.followUpAt : 'Choose a follow-up date if needed',
    outcome:visit.feedbackOutcome || 'General relationship visit',
    feedbackOutcome:visit.feedbackOutcome || 'General relationship visit'
  };
}
