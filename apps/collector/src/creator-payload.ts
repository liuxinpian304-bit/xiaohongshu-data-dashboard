export interface CreatorNoteRecord {
  platformId: string;
  title: string;
  publishedAt: string;
  metrics: { views: number | null; likes: number | null; comments: number | null };
  capturedAt: string;
}
export interface CreatorCommentRecord {
  platformId: string;
  noteId: string;
  parentPlatformId: string | null;
  content: string;
  publishedAt: string;
  likeCount: number;
}
export interface CreatorPayloadResult {
  notes: CreatorNoteRecord[];
  comments: CreatorCommentRecord[];
  page: { cursor: string | null; hasMore: boolean } | null;
}

const MAX_PAYLOAD_BYTES = 5_000_000;
const MAX_DEPTH = 32;

export function parseCreatorPayload(payload: unknown, capturedAt: string): CreatorPayloadResult {
  let encoded: string;
  try { encoded = JSON.stringify(payload); }
  catch { throw new Error('collector_payload_invalid'); }
  if (Buffer.byteLength(encoded) > MAX_PAYLOAD_BYTES) throw new Error('collector_payload_too_large');
  const notes = new Map<string, CreatorNoteRecord>();
  const comments = new Map<string, CreatorCommentRecord>();
  let page: CreatorPayloadResult['page'] = null;

  const visit = (value: unknown, depth: number, parentCommentId: string | null = null) => {
    if (depth > MAX_DEPTH) throw new Error('collector_payload_too_deep');
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1, parentCommentId); return; }
    if (!isObject(value)) return;

    const hasMore = boolean(value.has_more ?? value.hasMore);
    if (hasMore !== null) page = { cursor: text(value.cursor ?? value.next_cursor ?? value.nextCursor) || null, hasMore };

    const commentId = text(value.comment_id ?? value.commentId);
    const creatorTitle = text(value.display_title);
    const noteId = text(value.note_id ?? value.noteId ?? (creatorTitle !== null ? value.id : null));
    const content = text(value.content ?? value.comment_content ?? value.commentContent);
    let nestedParent = parentCommentId;
    if (commentId && noteId && content !== null) {
      const publishedAt = time(value.create_time ?? value.createTime ?? value.publish_time ?? value.publishedAt);
      const likeCount = count(value.like_count ?? value.likeCount) ?? 0;
      if (publishedAt) {
        const explicitParent = text(value.target_comment_id ?? value.parent_comment_id ?? value.parentCommentId);
        comments.set(commentId, { platformId: commentId, noteId, parentPlatformId: explicitParent ?? parentCommentId, content, publishedAt, likeCount });
        nestedParent = commentId;
      }
    }

    const title = text(value.title ?? value.note_title ?? value.noteTitle ?? value.display_title);
    const publishedAt = time(value.publish_time ?? value.publishTime ?? value.published_at ?? value.publishedAt ?? value.time);
    if (!commentId && noteId && title !== null && publishedAt) {
      notes.set(noteId, {
        platformId: noteId,
        title,
        publishedAt,
        metrics: {
          views: count(value.view_count ?? value.viewCount ?? value.read_count ?? value.readCount),
          likes: count(value.like_count ?? value.likeCount ?? value.liked_count ?? value.likedCount ?? value.likes),
          comments: count(value.comment_count ?? value.commentCount ?? value.comments_count),
        },
        capturedAt: iso(capturedAt),
      });
    }

    for (const [key, child] of Object.entries(value)) {
      const childParent = /sub.?comments|replies/i.test(key) ? nestedParent : parentCommentId;
      visit(child, depth + 1, childParent);
    }
  };
  visit(payload, 0);
  return { notes: [...notes.values()], comments: [...comments.values()], page };
}

function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown) { return typeof value === 'string' && value.length <= 20_000 ? value : null; }
function boolean(value: unknown) { return typeof value === 'boolean' ? value : null; }
function count(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function iso(value: string) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('collector_timestamp_invalid'); return date.toISOString(); }
function time(value: unknown) {
  if (typeof value === 'string') {
    if (/^\d{1,16}$/.test(value)) return time(Number(value));
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
