import { redirect } from 'next/navigation';
import { JobAction, StartJob } from '../../../components/job-actions';
import { JobProgress } from '../../../components/job-progress';
import { accountLabel } from '../../../lib/account-label';
import { getAccounts, getJobs } from '../../../lib/api';
import { formatShanghaiDateTime } from '../../../lib/format';

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const [result, accounts] = await Promise.all([getJobs(cursor), getAccounts()]);
  if (result.status === 'unauthorized' || accounts.status === 'unauthorized') redirect('/login?next=/jobs');
  const choices = accounts.status === 'ok' ? accounts.data.items.map((account) => ({ id: account.id, name: accountLabel(account) })) : [];
  return <div className="workflow-page">
    <header className="workflow-heading"><div><h1>同步任务</h1><p>立即同步、取消进行中任务，或为失败任务创建重试。</p></div></header>
    <StartJob accounts={choices}/>
    {result.status === 'error' ? <section className="load-error" role="alert"><h2>任务暂时无法加载</h2><p>{result.message}</p><a href="/jobs">重新加载</a></section> : result.data.items.length ? <section className="workflow-list">{result.data.items.map((job) => <article key={job.id}><div><h2>{job.status === 'failed' ? '同步失败' : job.status === 'succeeded' ? '同步完成' : '同步进行中'}</h2><p>{formatShanghaiDateTime(job.createdAt)} · 账号 {job.accountId.slice(0, 8)}</p>{job.error ? <span className="form-error">{job.error}</span> : null}</div><JobProgress status={job.status} stage={job.currentStage}/><JobAction id={job.id} accountId={job.accountId} status={job.status}/></article>)}</section> : <section className="workflow-empty"><strong>还没有同步任务</strong><span>选择账号后可发起首次同步。</span></section>}
  </div>;
}
