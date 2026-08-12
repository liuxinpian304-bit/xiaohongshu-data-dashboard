'use client';
import { useState } from 'react';

export function NoteExport({ accountId, platform }: { accountId?: string; platform?: 'xiaohongshu'|'douyin' }) {
  const [state, setState] = useState(''); const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); setState('正在打包全部作品和评论…'); try { const q = new URLSearchParams(); if (accountId) q.set('accountId', accountId); if(platform) q.set('platform',platform); const response = await fetch(`/api/notes/export?${q}`); if (!response.ok) throw new Error(); const blob = await response.blob(); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'platform-data.zip'; link.click(); URL.revokeObjectURL(href); setState('导出已开始下载。'); } catch { setState('导出失败，请稍后重试。'); } finally { setBusy(false); } }
  return <div className="note-export"><button className="primary-button" type="button" onClick={run} disabled={busy}>{busy ? '正在导出…' : '一键导出全部数据'}</button><span role="status">{state}</span></div>;
}
