const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export function formatMetric(value: string | number | null): string {
  if (value === null) return '—';
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  return Number.isFinite(numericValue) ? integerFormatter.format(numericValue) : String(value);
}
