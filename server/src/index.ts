import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { config, integrationStatus } from './config.ts';
import { connectDb } from './db.ts';
import { startRealtime } from './realtime.ts';
import { seedIfEmpty } from './seed.ts';
import { startLedgerWorker } from './services/audit.ts';
import { startCodeFrostPoller } from './services/codefrost.ts';
import { startHistory } from './services/history.ts';

await connectDb();
if (await seedIfEmpty()) console.log('[seed] database was empty, loaded demo shelters');

const server = createServer(createApp());
startRealtime(server);
startLedgerWorker();
startCodeFrostPoller();
await startHistory();

server.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log('[api] integrations:', integrationStatus());
});
