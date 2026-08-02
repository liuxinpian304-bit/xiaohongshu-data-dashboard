import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type ReportType = 'daily' | 'weekly' | 'monthly';

export interface ReportPeriod {
  type: ReportType;
  start: Date;
  end: Date;
  label: string;
}

const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export function getReportPeriod(type: ReportType, now: Date): ReportPeriod {
  const shanghaiNow = toZonedTime(now, BUSINESS_TIME_ZONE);

  if (type === 'daily') {
    const day = subDays(startOfDay(shanghaiNow), 1);
    return createPeriod(type, day, endOfDay(day), format(day, 'yyyy年MM月dd日'));
  }

  if (type === 'weekly') {
    const start = subWeeks(startOfISOWeek(shanghaiNow), 1);
    const end = endOfDay(addDays(start, 6));
    return createPeriod(
      type,
      start,
      end,
      `${getISOWeekYear(start)}年第${getISOWeek(start)}周`,
    );
  }

  const month = subMonths(startOfMonth(shanghaiNow), 1);
  return createPeriod(type, month, endOfMonth(month), format(month, 'yyyy年MM月'));
}

function createPeriod(
  type: ReportType,
  zonedStart: Date,
  zonedEnd: Date,
  label: string,
): ReportPeriod {
  return {
    type,
    start: fromZonedTime(zonedStart, BUSINESS_TIME_ZONE),
    end: fromZonedTime(zonedEnd, BUSINESS_TIME_ZONE),
    label,
  };
}
