import { addDays, endOfMonth, format, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export type RollingSyncMode = 'month_to_date' | 'previous_month_final';

export interface RollingSyncWindow {
  mode: RollingSyncMode;
  dates: string[];
}

export function getRollingSyncDates(now: Date): RollingSyncWindow {
  const businessToday = startOfDay(toZonedTime(now, BUSINESS_TIME_ZONE));
  const isMonthStart = businessToday.getDate() === 1;
  const firstDate = isMonthStart ? startOfMonth(subMonths(businessToday, 1)) : startOfMonth(businessToday);
  const lastDate = isMonthStart ? endOfMonth(firstDate) : subDays(businessToday, 1);

  return {
    mode: isMonthStart ? 'previous_month_final' : 'month_to_date',
    dates: datesBetween(firstDate, lastDate),
  };
}

export function rollingSyncJobId(accountId: string, date: string, mode: string): string {
  return `rolling-sync-${mode}-${date}-${accountId}`;
}

function datesBetween(start: Date, end: Date): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(format(date, 'yyyy-MM-dd'));
  return dates;
}
