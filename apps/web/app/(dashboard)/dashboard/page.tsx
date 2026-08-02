import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MetricCard } from '../../../components/metric-card';
import { MetricTrendChart } from '../../../components/metric-trend-chart';
import { PeriodTabs } from '../../../components/period-tabs';
import { getAuthorizedOfficialAccounts, getDashboard, getRecentNotifications, type DashboardCard, type DashboardPeriod } from '../../../lib/api';
import { formatMetric, formatReportRange, formatShanghaiDateTime } from '../../../lib/format';

const metricLabels: Record<string, string> = {
  notes: '笔记', likes: '点赞', favorites: '收藏', comments: '评论',
  impressions: '曝光', views: '访客', new_comments: '新增评论',
};
const periodLabels: Record<DashboardPeriod, string> = { daily: '日报', weekly: '周报', monthly: '月报' };

function normalizePeriod(value: string | string[] | undefined): DashboardPeriod {
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function metricLabel(key: string) {
  return metricLabels[key] ?? key;
}

function sourceLabel(source: string | null) {
  if (source === 'official') return '官方 API';
  if (source === 'mock') return '演示连接器';
  if (source === 'mixed') return '多个数据来源';
  return source ?? '暂无快照来源';
}

function chooseTrend(trend: Array<{ date: string; metrics: DashboardCard[] }>) {
  const priority = ['impressions', 'views', 'likes', 'comments', 'favorites'];
  const availableKeys = new Set(trend.flatMap(({ metrics }) => metrics.filter(({ availability, value }) => (availability === 'available' || availability === 'zero') && value !== null).map(({ key }) => key)));
  const key = priority.find((candidate) => availableKeys.has(candidate)) ?? [...availableKeys][0];
  if (!key) return { key: null, label: '指标', points: [] };
  const points = trend.flatMap(({ date, metrics }) => {
    const metric = metrics.find((candidate) => candidate.key === key && candidate.value !== null);
    if (!metric) return [];
    const value = Number(metric.value);
    return Number.isFinite(value) ? [{ label: date, value }] : [];
  });
  return { key, label: metricLabel(key), points };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[]; accountId?: string | string[] }> }) {
  const params = await searchParams; const period = normalizePeriod(params.period); const requestedAccountId = typeof params.accountId === 'string' ? params.accountId : undefined;
  const accountsResult = await getAuthorizedOfficialAccounts();
  if (accountsResult.status === 'unauthorized') redirect(`/login?next=${encodeURIComponent(`/dashboard?period=${period}`)}`);
  const officialAccounts = accountsResult.status === 'ok' ? accountsResult.data.items : [];
  const invalidAccount = accountsResult.status === 'ok' && Boolean(requestedAccountId) && !officialAccounts.some(({ id }) => id === requestedAccountId);
  const accountId = requestedAccountId;
  const [dashboardResult, notificationsResult] = await Promise.all([getDashboard(period, accountId), getRecentNotifications()]);
  const suffix = `${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`;
  if (dashboardResult.status === 'unauthorized' || notificationsResult.status === 'unauthorized') redirect(`/login?next=${encodeURIComponent(`/dashboard?period=${period}${suffix}`)}`);

  if (dashboardResult.status === 'error') {
    const invalidMessage = invalidAccount ? '所选账号不存在、授权已过期或已停用，请重新选择已授权的官方账号。' : `${dashboardResult.message}，请检查服务状态后重试。`;
    return (
      <div className="dashboard-page">
        <header className="dashboard-heading dashboard-heading--error"><div><h1>昨日数据</h1><p>按上海时区生成，官方数据未到齐时会明确标记。</p></div><PeriodTabs period={period} accountId={accountId} /></header>
        <section className="load-error" role="alert"><span aria-hidden="true">!</span><h2>{invalidAccount ? '账号不可用' : '数据暂时无法加载'}</h2><p>{invalidMessage}</p>{invalidAccount ? <Link href="/accounts">检查账号授权</Link> : <a href={`/dashboard?period=${period}${suffix}`}>重新加载</a>}</section>
      </div>
    );
  }

  const dashboard = dashboardResult.data;
  const cards = dashboard.cards.map((card) => ({ label: metricLabel(card.key), card }));
  const completeCount = cards.filter(({ card }) => card.availability === 'available' || card.availability === 'zero').length;
  const coverage = cards.length ? Math.round((completeCount / cards.length) * 100) : 0;
  const trend = chooseTrend(dashboard.trend);

  return (
    <div className="dashboard-page">
      <header className="dashboard-heading">
        <div><h1>昨日数据</h1><p>按上海时区生成，官方数据未到齐时会明确标记。</p></div>
        <PeriodTabs period={period} accountId={accountId} />
        <form className="account-filter" action="/dashboard" method="get"><input type="hidden" name="period" value={period} /><label htmlFor="dashboard-account">小红书账号</label><select id="dashboard-account" name="accountId" defaultValue={accountId ?? ''}><option value="">全部官方账号</option>{officialAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.platformId}</option>)}</select><button type="submit">查看</button></form>
        <dl className="report-meta">
          <div><dt>统计日期</dt><dd>{formatReportRange(dashboard.periodStart, dashboard.periodEnd)}</dd></div>
          <div><dt>最后同步</dt><dd>{dashboard.lastSyncedAt ? formatShanghaiDateTime(dashboard.lastSyncedAt) : '尚无成功同步'}</dd></div>
          <div><dt>数据来源</dt><dd>{sourceLabel(dashboard.source)}</dd></div>
        </dl>
      </header>

      {accountsResult.status === 'error' ? <section className="account-state" role="status">账号列表暂时无法加载，已保留当前筛选，请稍后重试。</section> : invalidAccount ? <section className="account-state" role="alert"><strong>所选账号不存在或尚未获得官方授权</strong><Link href="/accounts">检查账号授权</Link></section> : officialAccounts.length === 0 ? <section className="account-state"><strong>尚无已授权的官方账号</strong><span>请先到账号页完成官方 API 授权。</span><Link href="/accounts">管理账号</Link></section> : null}

      {cards.length ? (
        <section className="metric-rail" aria-label="核心指标">{cards.map(({ label, card }) => <MetricCard key={card.key} label={label} value={card.value} availability={card.availability} />)}</section>
      ) : <section className="metric-empty" aria-label="核心指标"><strong>该周期暂无指标</strong><span>官方快照到达后会显示在这里。</span></section>}

      <div className="dashboard-grid">
        <section className="panel panel--trend">
          <div className="panel-heading"><div><h2>核心指标趋势</h2><p>展示当前报告周期的官方快照</p></div><span className="panel-meta">{trend.key ? trend.label : periodLabels[period]}</span></div>
          <MetricTrendChart label={trend.label} points={trend.points} />
        </section>

        <section className="panel completeness-panel">
          <div className="panel-heading"><div><h2>数据完整性</h2><p>按官方能力和本轮同步结果判定</p></div><strong>{coverage}%</strong></div>
          <div className="coverage-track" aria-label={`数据覆盖率 ${coverage}%`}><span style={{ width: `${coverage}%` }} /></div>
          {cards.length ? <ul className="availability-list">{cards.map(({ label, card }) => {
            const ready = card.availability === 'available' || card.availability === 'zero';
            const state = ready ? '已就绪' : card.availability === 'awaiting_authorization' ? '等待授权' : card.availability === 'not_provided' ? '官方未提供' : '待同步';
            return <li key={card.key}><span>{label}</span><span className="state-dot" data-ready={ready} /> <strong>{state}</strong></li>;
          })}</ul> : <p className="panel-note">本周期没有可评估的指标。</p>}
          <p className="panel-note">“已就绪”只代表已处理官方本轮返回的数据。</p>
        </section>

        <section className="panel ranking-panel">
          <div className="panel-heading"><div><h2>笔记榜单</h2><p>按当前周期的实际指标排序</p></div><Link href="/notes">查看笔记</Link></div>
          {dashboard.rankedNotes.length ? <div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>排名</th><th>笔记</th><th>统一指标</th><th>周期新增</th></tr></thead><tbody>{dashboard.rankedNotes.map((note, index) => <tr key={note.id}><td>{index + 1}</td><td><Link href={`/notes/${note.id}`}>{note.title}</Link></td><td>{metricLabel(note.metricKey)}</td><td>{formatMetric(note.value)}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>暂无可排名的笔记</strong><span>本周期有可用指标后，榜单会自动更新。</span></div>}
        </section>

        <section className="panel notifications-panel">
          <div className="panel-heading"><div><h2>最新通知</h2><p>同步、评论与报告状态</p></div><Link href="/notifications">查看全部</Link></div>
          {notificationsResult.status === 'error' ? <div className="compact-error" role="status"><strong>通知暂时无法加载</strong><span>{notificationsResult.message}</span><a href={`/dashboard?period=${period}${suffix}`}>重新加载</a></div> : notificationsResult.data.items.length ? (
            <ul className="notification-list">{notificationsResult.data.items.map((item) => <li key={item.id}><span className="unread-dot" data-read={Boolean(item.readAt)} /><Link href={item.link || '/notifications'}><strong>{item.title}</strong><span>{item.body}</span></Link><time dateTime={item.createdAt}>{formatShanghaiDateTime(item.createdAt)}</time></li>)}</ul>
          ) : <div className="compact-empty"><strong>暂无通知</strong><span>新评论、同步结果和报告完成后会出现在这里。</span></div>}
        </section>
      </div>
    </div>
  );
}
