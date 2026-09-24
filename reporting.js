import { isInRange } from './domain.js';

export function formatTradeTime(minutes) {
  const rounded = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(rounded / 60), remainder = rounded % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder} min`;
}

export function activityMetrics(workspace, range) {
  const visits = workspace.visits.filter(v => v.end && isInRange(v.start, range));
  const trips = workspace.travel.trips.filter(t => isInRange(t.start, range));
  const tasksDue = workspace.tasks.filter(t => isInRange(t.due, range));
  const tasksCompleted = workspace.tasks.filter(t => t.done && t.completedAt && isInRange(t.completedAt, range));
  // Unknown completion dates are not the same as due dates. Keep originals intact.
  const undatedCompleted = workspace.tasks.filter(t => t.done && (!t.completedAt || !Number.isFinite(new Date(t.completedAt).getTime()))).length;
  const minutes = visits.reduce((sum,v) => {
    const elapsed = (new Date(v.end)-new Date(v.start))/60000;
    return sum + (Number.isFinite(elapsed) ? Math.max(0,elapsed) : 0);
  },0);
  return {visits,trips,tasksDue,tasksCompleted,undatedCompleted,minutes};
}
