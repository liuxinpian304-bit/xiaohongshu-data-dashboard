import { CommentCompleteness, type CommentCompletenessState } from './comment-completeness';
import { formatShanghaiDateTime } from '../lib/format';
import React from 'react';

export type CommentItem = { id: string; platformId: string; parentPlatformId: string | null; authorName?: string | null; content: string; publishedAt: string; likeCount: number };

export function CommentTree({ comments, completeness }: { comments: CommentItem[]; completeness: CommentCompletenessState }) {
  const idByPlatform = new Map(comments.map((item) => [item.platformId, item.id]));
  const roots = comments.filter((item) => !item.parentPlatformId || !idByPlatform.has(item.parentPlatformId));
  const replies = new Map<string, CommentItem[]>();
  for (const item of comments) if (item.parentPlatformId && idByPlatform.has(item.parentPlatformId)) replies.set(item.parentPlatformId, [...(replies.get(item.parentPlatformId) ?? []), item]);
  const row = (item: CommentItem, parentId?: string) => <li className="comment-row" key={item.id}><article>{item.authorName ? <strong>{item.authorName}</strong> : null}<p data-parent-id={parentId}>{item.content}</p><footer><time dateTime={item.publishedAt}>{formatShanghaiDateTime(item.publishedAt)}</time><span>{item.likeCount} 个赞</span></footer></article>{(replies.get(item.platformId) ?? []).length ? <ul className="comment-replies">{replies.get(item.platformId)!.map((reply) => row(reply, item.id))}</ul> : null}</li>;
  return <><CommentCompleteness state={completeness} />{comments.length ? <ul className="comment-tree">{roots.map((item) => row(item))}</ul> : <div className="workflow-empty"><strong>没有符合条件的评论</strong><span>请放宽筛选条件，或等待下一次同步。</span></div>}</>;
}
