export const METRIC_AGGREGATIONS = ['cumulative_delta', 'sum_interval', 'period_end', 'deduplicated_period'] as const;
export type MetricAggregation = typeof METRIC_AGGREGATIONS[number];

export type AggregationValue = { value: number; authoritativePeriod?: boolean };

export function aggregateMetricSeries(aggregation: MetricAggregation, series: readonly AggregationValue[]): number | null {
  if (!series.length) return null;
  if (aggregation === 'deduplicated_period') {
    const authoritative = series.filter(({ authoritativePeriod }) => authoritativePeriod);
    return authoritative.length === 1 ? authoritative[0]!.value : null;
  }
  if (aggregation === 'sum_interval') return series.reduce((sum, item) => sum + item.value, 0);
  if (aggregation === 'period_end') return series.at(-1)!.value;
  if (series.length < 2) return null;
  let result = 0;
  for (let index = 1; index < series.length; index += 1) {
    const before = series[index - 1]!.value; const after = series[index]!.value;
    result += after >= before ? after - before : after;
  }
  return result;
}

/** @deprecated Use aggregateMetricSeries with an explicit aggregation semantic. */
export function aggregateCumulative(values: readonly number[]): number {
  return aggregateMetricSeries('cumulative_delta', values.map((value) => ({ value }))) ?? 0;
}
