import Link from 'next/link';

import { MetricCard } from '../../../components/metric-card';
import { MetricTrendChart } from '../../../components/metric-trend-chart';
import { getDashboard, getRecentNotifications, type DashboardCard, type DashboardPeriod } from '../../../lib/api';

const metricDefinitions = [
  ['notes', '笔记'],
  ['likes', '点赞'],
  ['favorites', '收藏'],
  ['comments', '评论'],
  ['impressions', '曝光'],
  ['views', '访客'],
  ['new_comments', '新增评论'],
] as const;

const periodLabels: Record<DashboardPeriod, string> = { daily: '日报', weekly: '周报', monthly: '月报' };

function normalizePeriod(value: string | string[] | undefined): DashboardPeriod {
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function shanghaiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')), weekday: pick('weekday') };
}

function formatUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function reportingRange(period: DashboardPeriod, now = new Date()) {
  const { year, month, day, weekday } = shanghaiDateParts(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  if (period === 'daily') {
    const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return formatUtcDate(yesterday);
  }
  if (period === 'monthly') {
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return `${formatUtcDate(start)} — ${formatUtcDate(end)}`;
  }
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const mondayOffset = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  const currentMonday = new Date(today); currentMonday.setUTCDate(today.getUTCDate() - mondayOffset);
  const start = new Date(currentMonday); start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return `${formatUtcDate(start)} — ${formatUtcDate(end)}`;
}

function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function getCards(cards: DashboardCard[] | undefined) {
  const byKey = new Map(cards?.map((card) => [card.key, card]));
  return metricDefinitions.map(([key, label]) => ({
    label,
    card: byKey.get(key) ?? { key, value: null, availability: 'not_synced' as const },
  }));
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const period = normalizePeriod((await searchParams).period);
  const [dashboard, notifications] = await Promise.all([getDashboard(period), getRecentNotifications()]);
  const cards = getCards(dashboard?.cards);
  const completeCount = cards.filter(({ card }) => card.availability === 'available' || card.availability === 'zero').length;
  const coverage = Math.round((completeCount / cards.length) * 100);

  return (
    <div className="dashboard-page">
      <header className="dashboard-heading">
        <div><h1>昨日数据</h1><p>按上海时区生成，官方数据未到齐时会明确标记。</p></div>
        <nav className="period-tabs" aria-label="报告周期">
          {(Object.keys(periodLabels) as DashboardPeriod[]).map((item) => (
            <Link href={`/dashboard?period=${item}`} data-active={period === item} aria-current={period === item ? 'page' : undefined} key={item}>{periodLabels[item]}</Link>
          ))}
        </nav>
        <dl className="report-meta">
          <div><dt>统计日期</dt><dd>{reportingRange(period)}</dd></div>
          <div><dt>最后同步</dt><dd>{dashboard ? '已读取最新快照' : '等待首次同步'}</dd></div>
        </dl>
      </header>

      {!dashboard ? <div className="status-banner" role="status"><span />暂时无法读取最新数据，页面已保留可用性状态。</div> : null}

      <section className="metric-rail" aria-label="核心指标">
        {cards.map(({ label, card }) => <MetricCard key={card.key} label={label} value={card.value} availability={card.availability} />)}
      </section>

      <div className="dashboard-grid">
        <section className="panel panel--trend">
          <div className="panel-heading"><div><h2>核心指标趋势</h2><p>展示当前报告周期的官方快照</p></div><span className="panel-meta">{periodLabels[period]}</span></div>
          <MetricTrendChart />
        </section>

        <section className="panel completeness-panel">
          <div className="panel-heading"><div><h2>数据完整性</h2><p>按官方能力和本轮同步结果判定</p></div><strong>{coverage}%</strong></div>
          <div className="coverage-track" aria-label={`数据覆盖率 ${coverage}%`}><span style={{ width: `${coverage}%` }} /></div>
          <ul className="availability-list">
            {cards.map(({ label, card }) => {
              const ready = card.availability === 'available' || card.availability === 'zero';
              const state = ready ? '已就绪' : card.availability === 'awaiting_authorization' ? '等待授权' : card.availability === 'not_provided' ? '官方未提供' : '待同步';
              return <li key={card.key}><span>{label}</span><span className="state-dot" data-ready={ready} /> <strong>{state}</strong></li>;
            })}
          </ul>
          <p className="panel-note">“已就绪”只代表已处理官方本轮返回的数据。</p>
        </section>

        <section className="panel ranking-panel">
          <div className="panel-heading"><div><h2>笔记榜单</h2><p>按当前周期的指标排序</p></div><Link href="/notes">查看笔记</Link></div>
          <div className="table-empty"><strong>暂无可排名的笔记</strong><span>完成第一次同步后，榜单会自动更新。</span></div>
        </section>

        <section className="panel notifications-panel">
          <div className="panel-heading"><div><h2>最新通知</h2><p>同步、评论与报告状态</p></div><Link href="/notifications">查看全部</Link></div>
          {notifications?.items.length ? (
            <ul className="notification-list">{notifications.items.map((item) => <li key={item.id}><span className="unread-dot" data-read={Boolean(item.readAt)} /><Link href={item.link || '/notifications'}><strong>{item.title}</strong><span>{item.body}</span></Link><time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time></li>)}</ul>
          ) : <div className="compact-empty"><strong>暂无通知</strong><span>新评论、同步结果和报告完成后会出现在这里。</span></div>}
        </section>
      </div>
    </div>
  );
}
