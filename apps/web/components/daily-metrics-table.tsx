import React from 'react';

import type { DashboardDailyRow } from '../lib/api';
import { formatMetric } from '../lib/format';
import { dailyMetricKeys, dailyMetricLabels, deltaFor, metricFor, shortDate, signedMetric, unavailableLabel, usable } from './daily-metric-utils';

function comparisonSummary(row: DashboardDailyRow) {
  const candidates = dailyMetricKeys.flatMap((key) => {
    const delta = deltaFor(row, key);
    if (!usable(delta)) return [];
    return [{ key, delta: delta!, numeric: Number(delta!.value) }];
  }).sort((a, b) => Math.abs(b.numeric) - Math.abs(a.numeric));
  const strongest = candidates[0];
  return strongest ? `${dailyMetricLabels[strongest.key]} ${signedMetric(strongest.delta.value)}` : '暂无环比';
}

export function DailyMetricsTable({ rows }: { rows: DashboardDailyRow[] }) {
  const newestFirst = [...rows].reverse();
  return <section className="daily-table-section" aria-labelledby="daily-table-title">
    <div className="daily-section-heading"><div><h2 id="daily-table-title">每日数据明细</h2><p>本月 1 日至昨天，每天单独展示</p></div></div>
    <div className="daily-table-wrap"><table className="daily-table" aria-label="每日数据明细">
      <thead><tr><th>日期</th>{dailyMetricKeys.map((key) => <th key={key}>{dailyMetricLabels[key]}</th>)}<th>较前一天</th></tr></thead>
      <tbody>{newestFirst.map((row) => <tr key={row.date}>
        <th scope="row">{shortDate(row.date)}</th>
        {dailyMetricKeys.map((key) => {
          const metric = metricFor(row, key);
          const delta = deltaFor(row, key);
          const signed = usable(delta) ? signedMetric(delta!.value) : null;
          return <td key={key}>{usable(metric) ? <><strong>{formatMetric(metric!.value)}</strong>{signed ? <small data-direction={signed.startsWith('+') ? 'up' : signed.startsWith('-') ? 'down' : 'flat'}>{signed}</small> : null}</> : <span className="daily-cell--missing">{unavailableLabel(metric?.availability)}</span>}</td>;
        })}
        <td className="daily-table__summary">{comparisonSummary(row)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
