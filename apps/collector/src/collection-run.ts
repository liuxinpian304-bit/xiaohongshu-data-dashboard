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

interface CollectionRunOptions<TEvent> {
  collect(progress: (value: CollectionProgress) => void, emit: (event: TEvent) => void, runId: string): Promise<void>;
  createRunId?: () => string;
}

export class CollectionRun<TEvent = never> {
  private current: CollectionStatus = emptyStatus();
  private collectedEvents: TEvent[] = [];

  constructor(private readonly options: CollectionRunOptions<TEvent>) {}

  status(): CollectionStatus {
    return { ...this.current };
  }

  events(runId: string): TEvent[] {
    if (this.current.runId !== runId) throw new Error('collector_run_not_found');
    return this.current.state === 'failed' ? [] : [...this.collectedEvents];
  }

  start(): CollectionStatus {
    if (this.current.state === 'running') return this.status();
    const runId = (this.options.createRunId ?? randomUUID)();
    this.collectedEvents = [];
    this.current = {
      runId,
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
    }, (event) => {
      if (this.current.state === 'running') this.collectedEvents.push(event);
    }, runId);
    void running
      .then(() => {
        this.current = { ...this.current, state: 'completed', stage: 'complete', changedAt: new Date().toISOString() };
      })
      .catch(() => {
        this.collectedEvents = [];
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
