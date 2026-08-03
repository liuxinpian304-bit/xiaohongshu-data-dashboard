export function JobProgress({ status, stage }: { status: string; stage: string }) {
  const value = status === 'succeeded' ? 100 : status === 'running' ? 55 : status === 'failed' ? 100 : 12;
  return <div className="job-progress"><div><span style={{ width: `${value}%` }} /></div><small>{status === 'failed' ? '未完成' : status === 'succeeded' ? '已完成' : stage === 'authorize' ? '等待授权检查' : '正在同步'}</small></div>;
}
