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
  it('does not promote a visible Xiaohuohua label to an authenticated Douyin account', async () => {
    await expect(discoverAccounts(fixtureSession)).resolves.toEqual([]);
  });

  it('reports an unavailable bridge without throwing', async () => {
    await expect(discoverAccounts({ status: 'unavailable', async visibleText() { return []; } })).resolves.toEqual([]);
  });
});
