import { randomUUID } from 'node:crypto';

export type CollectionStage = 'account' | 'notes' | 'metrics' | 'comments' | 'replies' | 'writing' | 'reports' | 'complete';
export type CollectionState = 'idle' | 'running' | 'completed' | 'failed';
export interface CollectionProgress {
  stage: Exclude<CollectionStage, 'complete'>;
  processed: number;
  total: number;
  incompleteNotes: number;
}
export interface CollectionStatus {
  runId: string | null;
  state: CollectionState;
  stage: CollectionStage;
  processed: number;
  total: number;
  incompleteNotes: number;
  changedAt: string;
  errorCode?: 'collector_collection_failed';
}

interface CollectionRunOptions {
  collect(progress: (value: CollectionProgress) => void): Promise<void>;
  createRunId?: () => string;
}

export class CollectionRun {
  private current: CollectionStatus = emptyStatus();

  constructor(private readonly options: CollectionRunOptions) {}

  status(): CollectionStatus {
    return { ...this.current };
  }

  start(): CollectionStatus {
    if (this.current.state === 'running') return this.status();
    this.current = {
      runId: (this.options.createRunId ?? randomUUID)(),
      state: 'running',
      stage: 'account',
      processed: 0,
      total: 0,
      incompleteNotes: 0,
      changedAt: new Date().toISOString(),
    };
    const running = this.options.collect((progress) => {
      if (this.current.state !== 'running') return;
      this.current = { ...this.current, ...progress, changedAt: new Date().toISOString() };
    });
    void running
      .then(() => {
        this.current = { ...this.current, state: 'completed', stage: 'complete', changedAt: new Date().toISOString() };
      })
      .catch(() => {
        this.current = { ...this.current, state: 'failed', changedAt: new Date().toISOString(), errorCode: 'collector_collection_failed' };
      });
    return this.status();
  }
}

function emptyStatus(): CollectionStatus {
  return {
    runId: null,
    state: 'idle',
    stage: 'account',
    processed: 0,
    total: 0,
    incompleteNotes: 0,
    changedAt: new Date().toISOString(),
  };
}
