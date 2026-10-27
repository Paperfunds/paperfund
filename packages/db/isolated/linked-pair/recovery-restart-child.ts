// Disposable regression child only. No listener, trade submission, grant or schema installation.
import { createDatabase } from '../../src/database.js';
import { LinkedStateStore } from './store.js';
import { digest } from '../../../protocols/isolated/linked-pair/external-flow.js';
const url = process.env['DATABASE_URL'];
if (!url || !new URL(url).pathname.startsWith('/paperfund_linked_test_'))
  throw Error('DISPOSABLE_DATABASE_REQUIRED');
const db = createDatabase(url);
try {
  const store = new LinkedStateStore(db, process.argv[2]!, process.argv[3]!, true, true);
  await store.assertAvailable();
  console.log(JSON.stringify({ hash: digest(await store.recover()) }));
} finally {
  await db.close();
}
