const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export function formatMetric(value: string | number | null): string {
  if (value === null) return '—';
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  return Number.isFinite(numericValue) ? integerFormatter.format(numericValue) : String(value);
}

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function formatReportRange(periodStart: string, periodEnd: string): string {
  const start = shanghaiDateFormatter.format(new Date(periodStart));
  const end = shanghaiDateFormatter.format(new Date(periodEnd));
  return start === end ? start : `${start} — ${end}`;
}

export function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
