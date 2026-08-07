import { redirect } from 'next/navigation';
import { SettingsOverview } from '../../../components/settings-overview';
import { getSettingsStatus } from '../../../lib/api';

export default async function SettingsPage() {
  const result = await getSettingsStatus();
  if (result.status === 'unauthorized') redirect('/login?next=/settings');
  return <div className="workflow-page"><header className="workflow-heading"><div><h1>系统设置</h1><p>查看数据驾驶舱的运行状态和数据连接配置。</p></div></header>{result.status === 'ok' ? <SettingsOverview status={result.data}/> : <section className="load-error" role="alert"><h2>系统状态暂时无法读取</h2><p>网页服务仍在运行，请稍后重新加载。</p><a href="/settings">重新加载</a></section>}</div>;
}
