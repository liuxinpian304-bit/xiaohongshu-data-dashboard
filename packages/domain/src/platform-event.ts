import type {
  CommentCompletenessState,
  ContentKind,
  ObservationSource,
  Platform,
} from './platform';

export type PlatformMetricKey = 'views' | 'likes' | 'comments' | 'favorites' | 'shares' | 'followers';
export type PlatformMetricAvailability = 'available' | 'zero' | 'not_provided';
export type PlatformEndReason = 'platform_end' | 'repeated_cursor' | 'page_changed' | 'authorization_required' | 'timeout';

type EventBase = {
  version: 2;
  platform: Platform;
  source: ObservationSource;
  runId: string;
};

export type PlatformCollectionEventV2 = EventBase & (
  | {
    type: 'account';
    account: {
      platformId: string;
      displayName: string;
      avatarUrl: string | null;
    };
  }
  | {
    type: 'content';
    content: {
      platformId: string;
      contentKind: ContentKind;
      title: string;
      publishedAt: string;
    };
  }
  | {
    type: 'metric';
    metric: {
      contentId: string;
      key: PlatformMetricKey;
      value: number | null;
      availability: PlatformMetricAvailability;
      capturedAt: string;
    };
  }
  | {
    type: 'comment';
    comment: {
      platformId: string;
      contentId: string;
      parentPlatformId: string | null;
      authorName: string;
      content: string;
      publishedAt: string;
      likeCount: number;
    };
  }
  | {
    type: 'completeness';
    contentId: string;
    scope: 'comments' | 'replies';
    status: CommentCompletenessState;
    reason: PlatformEndReason;
  }
  | {
    type: 'completed';
    completedAt: string;
  }
);
