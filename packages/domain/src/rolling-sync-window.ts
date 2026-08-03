import { formatInTimeZone } from 'date-fns-tz';

const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export type RollingSyncMode = 'month_to_date' | 'previous_month_final';

export interface RollingSyncWindow {
  mode: RollingSyncMode;
  dates: string[];
}

export function getRollingSyncDates(now: Date): RollingSyncWindow {
  const [year, month, day] = formatInTimeZone(now, BUSINESS_TIME_ZONE, 'yyyy-MM-dd').split('-').map(Number) as [number, number, number];
  const isMonthStart = day === 1;
  const currentMonthStart = Date.UTC(year, month - 1, 1);
  const firstDate = isMonthStart ? Date.UTC(year, month - 2, 1) : currentMonthStart;
  const lastDate = isMonthStart ? currentMonthStart - DAY_MS : Date.UTC(year, month - 1, day) - DAY_MS;

  return {
    mode: isMonthStart ? 'previous_month_final' : 'month_to_date',
    dates: datesBetween(firstDate, lastDate),
  };
}

export function rollingSyncJobId(accountId: string, date: string, mode: string): string {
  return `rolling-sync-${mode}-${date}-${accountId}`;
}

function datesBetween(start: number, end: number): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date += DAY_MS) dates.push(new Date(date).toISOString().slice(0, 10));
  return dates;
}

const DAY_MS = 24 * 60 * 60_000;
