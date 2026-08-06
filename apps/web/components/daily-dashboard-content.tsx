import React from 'react';

import type { DashboardDailyRow } from '../lib/api';
import { DailyMetricOverview } from './daily-metric-overview';
import { DailyMetricsTable } from './daily-metrics-table';
import { DailyTrendExplorer } from './daily-trend-explorer';

export function DailyDashboardContent({ rows }: { rows: DashboardDailyRow[] }) {
  const latest = rows.at(-1);
  if (!latest) return <section className="daily-empty"><strong>本月暂无可展示日报</strong><span>本月第一个自然日结束并完成同步后，逐日数据会显示在这里。</span></section>;

  return <div className="daily-dashboard-content">
    <DailyMetricOverview row={latest} />
    <DailyTrendExplorer rows={rows} />
    <DailyMetricsTable rows={rows} />
  </div>;
}
