export type CommentCompletenessState = 'page_complete' | 'has_more' | 'unknown';
import React from 'react';

export function CommentCompleteness({ state }: { state: CommentCompletenessState }) {
  const copy = state === 'page_complete'
    ? ['本轮官方分页已完成', '仅代表本轮接口分页已读完，不代表历史评论已全部抓取。']
    : state === 'has_more'
      ? ['还有评论未加载', '浏览器只保留当前页，点击加载更多继续查看。']
      : ['完整度待确认', '数据源未返回可验证的分页完成状态。'];
  return <aside className="completeness-note" data-state={state} role="status"><strong>{copy[0]}</strong><span>{copy[1]}</span></aside>;
}
