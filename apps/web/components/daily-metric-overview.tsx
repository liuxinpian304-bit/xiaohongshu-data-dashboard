import React from 'react';

import type { DashboardDailyRow } from '../lib/api';
import { formatMetric } from '../lib/format';
import { dailyMetricKeys, dailyMetricLabels, deltaFor, metricFor, shortDate, signedMetric, unavailableLabel, usable } from './daily-metric-utils';

export function DailyMetricOverview({ row }: { row: DashboardDailyRow }) {
  return (
    <section className="daily-overview" aria-labelledby="daily-overview-title">
      <div className="daily-section-heading">
        <div><h2 id="daily-overview-title">{shortDate(row.date)}概览</h2><p>最近一个已结束自然日</p></div>
      </div>
      <div className="daily-overview__rail">
        {dailyMetricKeys.map((key) => {
          const metric = metricFor(row, key);
          const delta = deltaFor(row, key);
          const signed = usable(delta) ? signedMetric(delta!.value) : null;
          return <article className="daily-overview__metric" key={key}>
            <span>{dailyMetricLabels[key]}</span>
            {usable(metric) ? <strong>{formatMetric(metric!.value)}</strong> : <strong className="daily-value--missing">{unavailableLabel(metric?.availability)}</strong>}
            <small data-direction={signed?.startsWith('+') ? 'up' : signed?.startsWith('-') ? 'down' : 'flat'}>{signed === null ? '暂无环比' : `较前一天 ${signed}`}</small>
          </article>;
        })}
      </div>
    </section>
  );
}
