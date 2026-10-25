export function businessToday(timeZone = 'Asia/Dhaka', instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function periodStart(today: string, period: 'month' | 'year') {
  return period === 'year' ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
}
