import { startWorker } from './worker.module';
import { verifyRuntimeDatabaseRole } from '@xhs/database';

await verifyRuntimeDatabaseRole();
const worker = startWorker();
worker.on('ready', () => console.log(JSON.stringify({ service: 'worker', event: 'started' })));
worker.on('failed', (job, error) => console.error(JSON.stringify({ service: 'worker', event: 'job_failed', jobId: job?.id, error: error.message })));
