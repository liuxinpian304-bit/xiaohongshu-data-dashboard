UPDATE "Notification"
SET "type" = 'sync_completed'
WHERE "type" NOT IN (
  'sync_completed', 'sync_failed', 'authorization_expired', 'new_comment',
  'comment_sync_incomplete', 'report_generated', 'report_rebuilt'
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_type_check" CHECK (
  "type" IN (
    'sync_completed', 'sync_failed', 'authorization_expired', 'new_comment',
    'comment_sync_incomplete', 'report_generated', 'report_rebuilt'
  )
);
