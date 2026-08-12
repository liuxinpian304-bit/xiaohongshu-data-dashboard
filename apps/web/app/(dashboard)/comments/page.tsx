import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CommentTree } from '../../../components/comment-tree';
import { CommentExport } from '../../../components/comment-export';
import { getAccounts, getComments, getNotes } from '../../../lib/api';
import { accountLabel } from '../../../lib/account-label';

type Query = { platform?: 'xiaohongshu'|'douyin'; accountId?: string; noteId?: string; from?: string; to?: string; keyword?: string; newOnly?: string; cursor?: string };

export default async function CommentsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const p = await searchParams;
  const apiFilter = { platform:p.platform, accountId: p.accountId, noteId: p.noteId, from: p.from, to: p.to, keyword: p.keyword, newOnly: p.newOnly ? 'true' : undefined, cursor: p.cursor };
  const [result, accounts, notes] = await Promise.all([getComments(apiFilter), getAccounts(), getNotes(p.accountId, undefined, p.platform)]);
  if (result.status === 'unauthorized' || accounts.status === 'unauthorized' || notes.status === 'unauthorized') redirect('/login?next=/comments');
  const items = result.status === 'ok' ? result.data.items : [];
  return <div className="workflow-page">
    <header className="workflow-heading"><div><h1>评论</h1><p>筛选、逐页查看和导出小红书与抖音评论。</p></div><CommentExport query={{platform:p.platform,accountId:p.accountId,noteId:p.noteId,from:p.from,to:p.to,keyword:p.keyword,newOnly:p.newOnly?'true':undefined}} /></header>
    <form className="filter-panel">
      <label>平台<select name="platform" defaultValue={p.platform ?? ''}><option value="">全部平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select></label><label>账号<select name="accountId" defaultValue={p.accountId ?? ''}><option value="">全部账号</option>{accounts.status === 'ok' ? accounts.data.items.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>) : null}</select></label>
      <label>作品<select name="noteId" defaultValue={p.noteId ?? ''}><option value="">全部作品</option>{notes.status === 'ok' ? notes.data.items.map((n) => <option key={n.id} value={n.id}>{n.platform === 'douyin' ? '抖音' : '小红书'} · {n.title}</option>) : null}</select></label>
      <label>开始日期<input name="from" type="date" defaultValue={p.from} /></label><label>结束日期<input name="to" type="date" defaultValue={p.to} /></label>
      <label>关键词<input name="keyword" defaultValue={p.keyword} placeholder="搜索当前页" /></label><label className="check-filter"><input name="newOnly" type="checkbox" value="1" defaultChecked={Boolean(p.newOnly)} />仅看近24小时新增</label><button>应用筛选</button>
    </form>
    {p.newOnly ? <p className="scope-note">“新增”指服务端在近 24 小时首次发现的评论，列表与导出使用同一筛选范围。</p> : null}
    {result.status === 'error' ? <section className="load-error" role="alert"><h2>评论暂时无法加载</h2><p>{result.message}</p><a href="/comments">重新加载</a></section> : <section className="panel"><CommentTree comments={items} completeness={result.data.pageInfo.hasMore ? 'has_more' : 'page_complete'} /></section>}
    {result.status === 'ok' && result.data.pageInfo.hasMore ? <Link className="load-more" href={{ pathname: '/comments', query: { ...p, cursor: result.data.pageInfo.nextCursor } }}>加载更多</Link> : null}
  </div>;
}
