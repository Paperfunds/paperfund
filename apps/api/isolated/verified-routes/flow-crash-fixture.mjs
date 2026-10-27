// Disposable database only. Parent test interrupts this process after a staged proof write.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createDatabase} from '../../../../packages/db/src/database.ts';
import {LinkedStateStore} from '../../../../packages/db/isolated/linked-pair/store.ts';
const u=new URL(process.env.FLOW_FIXTURE_DATABASE);
if(u.hostname!=='127.0.0.1'||u.port!=='55462'||!u.pathname.startsWith('/paperfund_linked_test_'))throw Error('DISPOSABLE_DATABASE_REQUIRED');
const db=createDatabase(u.href),connect=db.pool.connect.bind(db.pool);
const isolated={...db,pool:{query:db.pool.query.bind(db.pool),connect:async()=>{const c=await connect(),query=c.query.bind(c);c.query=async(...args)=>{const result=await query(...args);if(String(args[0]).startsWith('insert into linked_flow_candidate.steps')){process.send('staged');await new Promise(()=>{});}return result;};return c;}}};
const interval=JSON.parse(gunzipSync(fs.readFileSync('docs/linked-pair-20261021/external-flow-completion/provider-459758217-459758224.json.gz')).toString());
await new LinkedStateStore(isolated,process.env.FLOW_FIXTURE_ACCOUNT,process.env.FLOW_FIXTURE_ROUND,true).advanceFlow(interval);
throw Error('INTERRUPTION_EXPECTED');
