'use client';

import React, { useMemo, useState } from 'react';

import type { DashboardDailyRow } from '../lib/api';
import { formatMetric } from '../lib/format';
import { dailyMetricLabels, metricFor, shortDate, trendMetricKeys, usable } from './daily-metric-utils';

function segments(points: Array<{ date: string; value: number } | null>) {
  const result: Array<Array<{ date: string; value: number; index: number }>> = [];
  let current: Array<{ date: string; value: number; index: number }> = [];
  points.forEach((point, index) => {
    if (point) current.push({ ...point, index });
    else if (current.length) { result.push(current); current = []; }
  });
  if (current.length) result.push(current);
  return result;
}

export function DailyTrendExplorer({ rows }: { rows: DashboardDailyRow[] }) {
  const initial = trendMetricKeys.find((key) => rows.some((row) => usable(metricFor(row, key)))) ?? 'likes';
  const [metricKey, setMetricKey] = useState<string>(initial);
  const label = dailyMetricLabels[metricKey] ?? metricKey;
  const points = useMemo(() => rows.map((row) => {
    const metric = metricFor(row, metricKey);
    return usable(metric) ? { date: row.date, value: Number(metric!.value) } : null;
  }), [metricKey, rows]);
  const available = points.filter((point): point is { date: string; value: number } => point !== null);
  const max = Math.max(...available.map(({ value }) => value), 1);
  const x = (index: number) => rows.length <= 1 ? 360 : 28 + (index / (rows.length - 1)) * 664;
  const y = (value: number) => 205 - (value / max) * 165;

  return <section className="daily-trend" aria-labelledby="daily-trend-title">
    <div className="daily-section-heading daily-section-heading--actions">
      <div><h2 id="daily-trend-title">本月每日趋势</h2><p>每个点代表一个独立自然日，不是累计值</p></div>
      <div className="daily-trend__tabs" aria-label="趋势指标">{trendMetricKeys.map((key) => <button aria-pressed={metricKey === key} key={key} onClick={() => setMetricKey(key)} type="button">{dailyMetricLabels[key]}</button>)}</div>
    </div>
    {available.length ? <>
      <svg className="daily-trend__chart" viewBox="0 0 720 240" role="img" aria-label={`${label}每日趋势图`}>
        {[40, 95, 150, 205].map((position) => <line className="chart-grid" key={position} x1="28" x2="692" y1={position} y2={position} />)}
        {segments(points).map((group, groupIndex) => <polyline className="chart-line" key={groupIndex} points={group.map((point) => `${x(point.index)},${y(point.value)}`).join(' ')} />)}
        {points.map((point, index) => point ? <circle key={point.date} cx={x(index)} cy={y(point.value)} r="4"><title>{`${shortDate(point.date)}：${formatMetric(point.value)}`}</title></circle> : null)}
      </svg>
      <table className="sr-only" aria-label={`${label}每日趋势数据`}><thead><tr><th>日期</th><th>{label}</th></tr></thead><tbody>{available.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.value}</td></tr>)}</tbody></table>
    </> : <div className="daily-trend__empty" role="img" aria-label={`${label}每日趋势图`}><strong>{label}暂无可用数据</strong><span>该指标同步后会按天展示，缺失值不会补零。</span></div>}
  </section>;
}
