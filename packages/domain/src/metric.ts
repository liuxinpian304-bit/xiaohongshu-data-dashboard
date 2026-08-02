import type { DataAvailability } from './data-availability';

export interface Metric<TValue = number> {
  value: TValue | null;
  availability: DataAvailability;
}
