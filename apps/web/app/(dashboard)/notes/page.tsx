import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NoteExplorer } from '../../../components/note-explorer';
import { NoteExport } from '../../../components/note-export';
import { getAccounts, getNotes } from '../../../lib/api';

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ accountId?: string; cursor?: string }> }) {
  const p = await searchParams; const [result, accounts] = await Promise.all([getNotes(p.accountId, p.cursor), getAccounts()]);
  if (result.status === 'unauthorized' || accounts.status === 'unauthorized') redirect('/login?next=/notes');
  return <div className="workflow-page"><header className="workflow-heading"><div><h1>笔记数据</h1><p>不用逐篇打开，直接查看每篇笔记的核心指标。</p></div><div className="note-page-actions"><NoteExport accountId={p.accountId}/><form className="inline-filter"><label htmlFor="note-account">账号</label><select id="note-account" name="accountId" defaultValue={p.accountId ?? ''}><option value="">全部账号</option>{accounts.status === 'ok' ? accounts.data.items.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.platformId}</option>) : null}</select><button>查看</button></form></div></header>
    {result.status === 'error' ? <section className="load-error" role="alert"><h2>笔记暂时无法加载</h2><p>{result.message}</p><a href="/notes">重新加载</a></section> : result.data.items.length ? <NoteExplorer notes={result.data.items}/> : <section className="workflow-empty"><strong>暂无笔记</strong><span>导入首份自有 JSON 数据或完成同步后，笔记会显示在这里。</span></section>}
    {result.status === 'ok' && result.data.pageInfo.hasMore ? <Link className="load-more" href={{ pathname: '/notes', query: { accountId: p.accountId, cursor: result.data.pageInfo.nextCursor } }}>加载更多</Link> : null}
  </div>;
}
