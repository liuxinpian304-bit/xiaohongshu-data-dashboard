import React from 'react';

export type DataAvailabilityState =
  | 'zero'
  | 'not_synced'
  | 'awaiting_authorization'
  | 'not_provided'
  | 'available';

const availabilityLabels: Record<Exclude<DataAvailabilityState, 'available' | 'zero'>, string> = {
  not_synced: '尚未同步',
  awaiting_authorization: '等待官方授权',
  not_provided: '官方未提供',
};

export function DataAvailability({ state }: { state: DataAvailabilityState }) {
  if (state === 'available' || state === 'zero') return null;

  return (
    <span className="availability" data-state={state}>
      {availabilityLabels[state]}
    </span>
  );
}
