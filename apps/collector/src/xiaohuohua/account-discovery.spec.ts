import { describe, expect, it } from 'vitest';

import { discoverAccounts } from './account-discovery';

const fixtureSession = {
  status: 'available' as const,
  async visibleText() {
    return [
      '自媒体 工作台 管理后台 添加账号',
      '刘鑫鹏 免费会员 凑热闹 调音全靠拧 Tonic P / 1 https://zs.xhh.com/webview/clienthome/?leader=1',
    ];
  },
};

describe('discoverAccounts', () => {
  it('discovers a visible Douyin account without reading credential storage', async () => {
    await expect(discoverAccounts(fixtureSession)).resolves.toEqual([
      expect.objectContaining({ platform: 'douyin', displayName: 'Tonic', loginState: 'authenticated' }),
    ]);
  });

  it('reports an unavailable bridge without throwing', async () => {
    await expect(discoverAccounts({ status: 'unavailable', async visibleText() { return []; } })).resolves.toEqual([]);
  });
});
