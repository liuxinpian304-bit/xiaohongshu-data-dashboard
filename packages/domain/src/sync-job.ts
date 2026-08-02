export type SyncJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface SyncJob {
  id: string;
  status: SyncJobStatus;
  startedAt: Date | null;
  completedAt: Date | null;
}
