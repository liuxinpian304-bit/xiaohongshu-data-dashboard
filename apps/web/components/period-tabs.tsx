import Link from 'next/link';
import React from 'react';

import type { DashboardPeriod } from '../lib/api';

const periodLabels: Record<DashboardPeriod, string> = { daily: '日报', weekly: '周报', monthly: '月报' };

export function PeriodTabs({ period, accountId }: { period: DashboardPeriod; accountId?: string }) {
  return (
    <nav className="period-tabs" aria-label="报告周期">
      {(Object.keys(periodLabels) as DashboardPeriod[]).map((item) => (
        <Link href={`/dashboard?period=${item}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`} data-active={period === item} aria-current={period === item ? 'page' : undefined} key={item}>{periodLabels[item]}</Link>
      ))}
    </nav>
  );
}
