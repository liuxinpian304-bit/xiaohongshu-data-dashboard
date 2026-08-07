'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import type { Note, NoteMetric } from '../lib/api';
import { formatMetric, formatShanghaiDateTime } from '../lib/format';

type View = 'table' | 'cards';
const metricKeys = ['views', 'likes', 'comments', 'favorites'] as const;
const metricLabels = { views: '阅读', likes: '点赞', comments: '评论', favorites: '收藏' };

function metricValue(metrics: NoteMetric[], key: typeof metricKeys[number]) {
  const metric = metrics.find((item) => item.key === key);
  if (!metric || (metric.availability !== 'available' && metric.availability !== 'zero')) return <span className="note-metric-unavailable">尚未同步</span>;
  return formatMetric(metric.value);
}

function sourceLabel(connectorType: string) {
  if (connectorType === 'self-scrape' || connectorType === 'self_import') return '账号自抓数据';
  if (connectorType === 'official') return '官方 API';
  return '其他数据来源';
}

export function NoteExplorer({ notes }: { notes: Note[] }) {
  const [view, setView] = useState<View>(() => typeof window === 'undefined' ? 'table' : localStorage.getItem('xhs-note-view') === 'cards' ? 'cards' : 'table');
  function choose(next: View) { setView(next); localStorage.setItem('xhs-note-view', next); }

  return <section className="note-explorer">
    <div className="note-explorer-toolbar" aria-label="笔记展示方式">
      <span>共 {notes.length} 篇笔记</span>
      <div><button type="button" aria-pressed={view === 'table'} onClick={() => choose('table')}>表格视图</button><button type="button" aria-pressed={view === 'cards'} onClick={() => choose('cards')}>卡片视图</button></div>
    </div>
    {view === 'table' ? <div className="note-table-wrap"><table className="note-table">
      <thead><tr><th>笔记</th><th>账号</th><th>发布时间</th>{metricKeys.map((key) => <th key={key}>{metricLabels[key]}</th>)}<th>数据来源</th></tr></thead>
      <tbody>{notes.map((note) => <tr key={note.id}>
        <td><Link href={`/notes/${note.id}`}>{note.title}</Link><small>ID {note.platformId}</small></td>
        <td>{note.account.displayName || note.account.platformId}</td><td>{formatShanghaiDateTime(note.publishedAt)}</td>
        {metricKeys.map((key) => <td className="note-table-number" key={key}>{metricValue(note.metrics, key)}</td>)}<td><span className="note-source">{sourceLabel(note.connectorType)}</span></td>
      </tr>)}</tbody>
    </table></div> : <div className="note-card-grid" data-testid="note-card-grid">{notes.map((note) => <article key={note.id} className="note-data-card">
      <div className="note-data-card-head"><div><Link href={`/notes/${note.id}`}>{note.title}</Link><small>{note.account.displayName || note.account.platformId} · {formatShanghaiDateTime(note.publishedAt)}</small></div><span className="note-source">{sourceLabel(note.connectorType)}</span></div>
      <dl>{metricKeys.map((key) => <div key={key}><dt>{metricLabels[key]}</dt><dd>{metricValue(note.metrics, key)}</dd></div>)}</dl>
    </article>)}</div>}
  </section>;
}
