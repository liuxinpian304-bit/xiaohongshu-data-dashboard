export const METRIC_AGGREGATIONS = ['cumulative_delta', 'sum_interval', 'period_end', 'deduplicated_period'] as const;
export type MetricAggregation = typeof METRIC_AGGREGATIONS[number];

export type AggregationValue = { value: number; authoritativePeriod?: boolean; windowStart?: Date; windowEnd?: Date };
export type AggregationPeriod = { start: Date; end: Date };

export function aggregateMetricSeries(aggregation: MetricAggregation, series: readonly AggregationValue[], period?: AggregationPeriod): number | null {
  if (!series.length) return null;
  if (aggregation === 'deduplicated_period') {
    const authoritative = series.filter((item) => item.authoritativePeriod && period && item.windowStart?.getTime() === period.start.getTime() && item.windowEnd?.getTime() === period.end.getTime());
    return authoritative.length === 1 ? authoritative[0]!.value : null;
  }
  if (aggregation === 'sum_interval') {
    if (!period) return null;
    const ordered = [...series].sort((a, b) => (a.windowStart?.getTime() ?? 0) - (b.windowStart?.getTime() ?? 0));
    if (ordered.some((item) => !item.authoritativePeriod || !item.windowStart || !item.windowEnd)) return null;
    if (ordered[0]!.windowStart!.getTime() !== period.start.getTime() || ordered.at(-1)!.windowEnd!.getTime() !== period.end.getTime()) return null;
    for (let index = 1; index < ordered.length; index += 1) if (ordered[index - 1]!.windowEnd!.getTime() !== ordered[index]!.windowStart!.getTime()) return null;
    return ordered.reduce((sum, item) => sum + item.value, 0);
  }
  if (aggregation === 'period_end') return series.filter((item) => item.authoritativePeriod && period && item.windowEnd?.getTime() === period.end.getTime()).at(-1)?.value ?? null;
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
