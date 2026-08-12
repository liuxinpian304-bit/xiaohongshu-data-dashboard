import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard responsive metadata layout', () => {
  it('stacks metadata into readable rows when the content area is narrow', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const tablet = css.match(/@media \(max-width: 1180px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tablet).toContain('.report-meta { width: 100%;');
    expect(tablet).toContain('grid-template-columns: 1fr');
    expect(tablet).toContain('grid-template-columns: minmax(86px, auto) minmax(0, 1fr)');
    expect(tablet).toContain('.report-meta dd { margin: 0; text-align: right; white-space: normal; overflow-wrap: anywhere; }');
  });

  it('stacks dashboard metadata into full-width rows on mobile', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const mobile = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toContain('.report-meta { width: 100%; order: 3; display: grid; grid-template-columns: 1fr;');
    expect(mobile).toContain('grid-template-columns: minmax(72px, auto) minmax(0, 1fr)');
    expect(mobile).toContain('.report-meta dd { margin: 0; text-align: right; white-space: normal; overflow-wrap: anywhere; }');
  });
});
