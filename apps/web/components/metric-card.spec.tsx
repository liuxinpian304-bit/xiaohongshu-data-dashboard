// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetricCard } from './metric-card';

afterEach(cleanup);

describe('MetricCard', () => {
  it('does not render unavailable metrics as zero', () => {
    render(
      <MetricCard
        label="访客"
        value={null}
        availability="awaiting_authorization"
      />,
    );

    expect(screen.getByText('等待官方授权')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('formats an available metric without changing its meaning', () => {
    render(<MetricCard label="点赞" value="4928" availability="available" />);

    expect(screen.getByText('4,928')).toBeInTheDocument();
    expect(screen.getByText('点赞')).toBeInTheDocument();
  });

  it('renders an explicitly available zero as zero', () => {
    render(<MetricCard label="评论" value="0" availability="zero" />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('尚未同步')).not.toBeInTheDocument();
  });

  it('does not expose non-finite numeric values', () => {
    render(<MetricCard label="曝光" value={Number.POSITIVE_INFINITY} availability="available" />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Infinity')).not.toBeInTheDocument();
  });
});
