import { describe, expect, it } from 'vitest';
import { noteExportWhere } from './note-export.service';

describe('note export scope', () => {
  it('keeps platform and account filters aligned for works and comments', () => {
    expect(noteExportWhere('douyin', 'account-1')).toEqual({ platform: 'douyin', accountId: 'account-1' });
    expect(noteExportWhere('xiaohongshu')).toEqual({ platform: 'xiaohongshu' });
  });
});
