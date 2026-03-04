import { format, subDays, parseISO } from 'date-fns';

export function formatDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function getDateRange(range: string): { from: string; to: string } {
  const today = new Date();
  const to = formatDate(today);

  switch (range) {
    case '1d':
      return { from: to, to }; // Today only
    case '7d':
      return { from: formatDate(subDays(today, 6)), to }; // Last 7 days including today
    case '30d':
      return { from: formatDate(subDays(today, 29)), to };
    case '90d':
      return { from: formatDate(subDays(today, 89)), to };
    case '365d':
      return { from: formatDate(subDays(today, 364)), to };
    default:
      return { from: formatDate(subDays(today, 29)), to };
  }
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

export function formatPercentage(num: number): string {
  return (num * 100).toFixed(1) + '%';
}

export function groupByDate(events: { time: number }[]): Map<string, number> {
  const grouped = new Map<string, number>();

  for (const event of events) {
    const date = formatDate(new Date(event.time * 1000));
    grouped.set(date, (grouped.get(date) || 0) + 1);
  }

  return grouped;
}


export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

export function getDaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  // Use noon UTC to avoid time zone shifts pushing the date backward/forward
  let current = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);

  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current = new Date(current.getTime() + 86400000);
  }

  return days;
}
