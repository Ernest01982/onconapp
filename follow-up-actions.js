// Resolve only records belonging to this follow-up's client.
export function followUpContext(workspace, taskId) {
  const task = workspace.tasks.find(item => item.id === taskId);
  if (!task) return null;
  const customer = workspace.customers.find(item => item.id === task.customerId) || null;
  const visits = workspace.visits.filter(item => item.customerId === task.customerId);
  const linked = visits.find(item => item.id === task.visitId || item.followUpTaskId === task.id);
  const visit = linked || visits.sort((a,b) => new Date(b.start)-new Date(a.start))[0] || null;
  const wine = workspace.products.find(item => item.id === task.wineId) || null;
  return {task, customer, visit, wine, linked: Boolean(linked)};
}

export function followUpMessage(workspace, context) {
  const {task,customer,wine} = context;
  const saved = (workspace.followUpMessageDrafts || []).find(item => item.taskId === task.id && item.customerId === task.customerId);
  if (saved) return saved;
  const person = task.contactPerson || customer?.contact || '';
  return {
    taskId:task.id, customerId:task.customerId,
    subject:`Namaqua Wines Follow-up - ${customer?.name || 'Client'}`,
    // Private visit notes and internal follow-up reasons stay out of outgoing messages.
    body:`Hi${person ? ' '+person.split(/\s+/)[0] : ''},\n\nI am following up${wine ? ' about '+wine.name : ''}.\n\nKind regards,\n${workspace.profile?.name || 'Ernest Reyneke'}\nNamaqua Wines`
  };
}
