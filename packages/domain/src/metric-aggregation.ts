export const METRIC_AGGREGATIONS = ['cumulative_delta', 'sum_interval', 'period_end', 'deduplicated_period'] as const;
export type MetricAggregation = typeof METRIC_AGGREGATIONS[number];

export type AggregationValue = { evidenceId?: string; value: number; authoritativePeriod?: boolean; windowStart?: Date; windowEnd?: Date };
/** Authoritative windows are half-open: [start, endExclusive). */
export type AggregationPeriod = { start: Date; endExclusive: Date };

export type AggregationTrace = { value: number | null; usedEvidenceIds: string[] };

export function aggregateMetricSeries(aggregation: MetricAggregation, series: readonly AggregationValue[], period?: AggregationPeriod): number | null {
  return aggregateMetricSeriesWithTrace(aggregation, series, period).value;
}

export function aggregateMetricSeriesWithTrace(aggregation: MetricAggregation, series: readonly AggregationValue[], period?: AggregationPeriod): AggregationTrace {
  const ids = (items: readonly AggregationValue[]) => items.flatMap(({ evidenceId }) => evidenceId ? [evidenceId] : []);
  if (!series.length) return { value: null, usedEvidenceIds: [] };
  if (aggregation === 'deduplicated_period') {
    const authoritative = series.filter((item) => item.authoritativePeriod && period && item.windowStart?.getTime() === period.start.getTime() && item.windowEnd?.getTime() === period.endExclusive.getTime());
    return authoritative.length === 1 ? { value: authoritative[0]!.value, usedEvidenceIds: ids(authoritative) } : { value: null, usedEvidenceIds: [] };
  }
  if (aggregation === 'sum_interval') {
    if (!period) return { value: null, usedEvidenceIds: [] };
    const ordered = [...series].sort((a, b) => (a.windowStart?.getTime() ?? 0) - (b.windowStart?.getTime() ?? 0));
    if (ordered.some((item) => !item.authoritativePeriod || !item.windowStart || !item.windowEnd)) return { value: null, usedEvidenceIds: [] };
    if (ordered[0]!.windowStart!.getTime() !== period.start.getTime() || ordered.at(-1)!.windowEnd!.getTime() !== period.endExclusive.getTime()) return { value: null, usedEvidenceIds: [] };
    for (let index = 1; index < ordered.length; index += 1) if (ordered[index - 1]!.windowEnd!.getTime() !== ordered[index]!.windowStart!.getTime()) return { value: null, usedEvidenceIds: [] };
    return { value: ordered.reduce((sum, item) => sum + item.value, 0), usedEvidenceIds: ids(ordered) };
  }
  if (aggregation === 'period_end') {
    const selected = series.filter((item) => item.authoritativePeriod && period && item.windowEnd?.getTime() === period.endExclusive.getTime()).at(-1);
    return selected ? { value: selected.value, usedEvidenceIds: ids([selected]) } : { value: null, usedEvidenceIds: [] };
  }
  if (series.length < 2) return { value: null, usedEvidenceIds: [] };
  let result = 0;
  for (let index = 1; index < series.length; index += 1) {
    const before = series[index - 1]!.value; const after = series[index]!.value;
    result += after >= before ? after - before : after;
  }
  return { value: result, usedEvidenceIds: ids(series) };
}

/** @deprecated Use aggregateMetricSeries with an explicit aggregation semantic. */
export function aggregateCumulative(values: readonly number[]): number {
  return aggregateMetricSeries('cumulative_delta', values.map((value) => ({ value }))) ?? 0;
}
