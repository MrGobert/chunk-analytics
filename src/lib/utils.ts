import { format, subDays, startOfWeek, startOfMonth, parseISO } from 'date-fns';

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function getDateRange(range: string): { from: string; to: string } {
  const today = new Date();
  const to = formatDate(today);

  switch (range) {
    case '7d':
      return { from: formatDate(subDays(today, 7)), to };
    case '30d':
      return { from: formatDate(subDays(today, 30)), to };
    case '90d':
      return { from: formatDate(subDays(today, 90)), to };
    default:
      return { from: formatDate(subDays(today, 30)), to };
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

export function groupByWeek(events: { time: number }[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const event of events) {
    const eventDate = new Date(event.time * 1000);
    const weekStart = formatDate(startOfWeek(eventDate));

    if (!grouped.has(weekStart)) {
      grouped.set(weekStart, new Set());
    }
  }

  return grouped;
}

export function groupByMonth(events: { time: number }[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const event of events) {
    const eventDate = new Date(event.time * 1000);
    const monthStart = formatDate(startOfMonth(eventDate));

    if (!grouped.has(monthStart)) {
      grouped.set(monthStart, new Set());
    }
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
  const start = parseISO(from);
  const end = parseISO(to);

  let current = start;
  while (current <= end) {
    days.push(formatDate(current));
    current = new Date(current.getTime() + 86400000);
  }

  return days;
}
