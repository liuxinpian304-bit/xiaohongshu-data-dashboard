// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { PeriodTabs } from './period-tabs';

afterEach(cleanup);

describe('PeriodTabs', () => {
  it('marks the selected period and links every server period', () => {
    render(<PeriodTabs period="weekly" />);

    expect(screen.getByRole('link', { name: '周报' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '日报' })).toHaveAttribute('href', '/dashboard?period=daily');
    expect(screen.getByRole('link', { name: '月报' })).toHaveAttribute('href', '/dashboard?period=monthly');
  });
});
