export function weekStart(today: string): string {
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== today) {
    throw new Error('Invalid business date.');
  }
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
