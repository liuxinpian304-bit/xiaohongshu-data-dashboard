export function accountLabel(account: { platform: string; displayName: string | null; platformId: string }) {
  const platform = account.platform === 'douyin' ? '抖音' : '小红书';
  return `${platform} · ${account.displayName || account.platformId}`;
}
