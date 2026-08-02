import React from 'react';

export type TrendPoint = { label: string; value: number };

export function MetricTrendChart({ points = [], label = '指标' }: { points?: TrendPoint[]; label?: string }) {
  if (points.length === 0) {
    return (
      <div className="chart-empty" role="img" aria-label="暂无趋势数据">
        <svg viewBox="0 0 720 230" preserveAspectRatio="none" aria-hidden="true">
          {[35, 85, 135, 185].map((y) => <line key={y} x1="0" x2="720" y1={y} y2={y} />)}
        </svg>
        <div><strong>同步后显示趋势</strong><span>当官方指标到达后，这里会按时间展示变化。</span></div>
      </div>
    );
  }

  const max = Math.max(...points.map(({ value }) => value), 1);
  const pointX = (index: number) => points.length === 1 ? 360 : (index / (points.length - 1)) * 720;
  const line = points.map(({ value }, index) => `${pointX(index)},${210 - (value / max) * 180}`).join(' ');
  return (
    <>
      <svg className="trend-chart" viewBox="0 0 720 230" role="img" aria-label={`${label}趋势图`}>
        {[35, 85, 135, 185].map((y) => <line className="chart-grid" key={y} x1="0" x2="720" y1={y} y2={y} />)}
        <polyline className="chart-line" points={line} />
        {points.map((point, index) => <circle key={point.label} cx={pointX(index)} cy={210 - (point.value / max) * 180} r="4"><title>{`${point.label}: ${point.value}`}</title></circle>)}
      </svg>
      <table className="sr-only" aria-label={`${label}趋势数据`}>
        <thead><tr><th>日期</th><th>{label}</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{point.value}</td></tr>)}</tbody>
      </table>
    </>
  );
}
