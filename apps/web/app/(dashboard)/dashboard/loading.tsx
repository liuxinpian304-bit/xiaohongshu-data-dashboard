export default function DashboardLoading() {
  return <div className="dashboard-page" aria-busy="true" aria-live="polite"><div className="loading-title" /><div className="loading-rail" /><div className="loading-daily-chart" /><div className="loading-daily-table" /><span className="sr-only">正在加载数据看板</span></div>;
}
