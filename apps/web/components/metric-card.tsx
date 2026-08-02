import React from 'react';

import { DataAvailability, type DataAvailabilityState } from './data-availability';
import { formatMetric } from '../lib/format';

type MetricCardProps = {
  label: string;
  value: string | number | null;
  availability: DataAvailabilityState;
};

export function MetricCard({ label, value, availability }: MetricCardProps) {
  const hasValue = availability === 'available' || availability === 'zero';

  return (
    <article className="metric-card" aria-label={`${label}指标`}>
      <span className="metric-card__label">{label}</span>
      {hasValue ? (
        <strong className="metric-card__value">{formatMetric(value)}</strong>
      ) : (
        <>
          <strong className="metric-card__value metric-card__value--muted">—</strong>
          <DataAvailability state={availability} />
        </>
      )}
    </article>
  );
}
