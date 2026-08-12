import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard responsive metadata layout', () => {
  it('lets all three metadata columns shrink without overlapping at tablet widths', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const tablet = css.match(/@media \(max-width: 1180px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tablet).toContain('.report-meta { width: 100%;');
    expect(tablet).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(tablet).toContain('.report-meta dd { white-space: normal; overflow-wrap: anywhere; }');
  });
});
