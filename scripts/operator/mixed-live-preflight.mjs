// Read-only preflight under the actual runtime roles. Does not start services or seed a branch.
import fs from'node:fs';import path from'node:path';import{pathToFileURL,fileURLToPath}from'node:url';
import{pinned,validatePlan,verifyRelease,verifyCapture,requireCondition as check,sha,assertScopeProjection,publishJson,readPreparedScope}from'./mixed-deployment.mjs';
export async function qualifyRuntimePrivileges(db,role){
 const c=await db.pool.connect();let checked=0;try{await c.query('begin read only');
 for(const table of ['users','assets','markets','competition_accounts','competition_token_slots','positions','orders','fills','market_state_evidence','order_market_state_evidence','journal_transactions','ledger_entries','idempotency_records','chart_fill_fx_evidence','chart_fill_fx_capture_failures'])for(const privilege of ['SELECT','INSERT']){check((await c.query('select has_table_privilege(current_user,$1,$2) ok',[table,privilege])).rows[0].ok,'ORDINARY_PRIVILEGE:'+table+':'+privilege);checked++;}
 for(const table of ['markets','competition_accounts','positions','orders','idempotency_records']){check((await c.query("select has_table_privilege(current_user,$1,'UPDATE') ok",[table])).rows[0].ok,'ORDINARY_UPDATE:'+table);checked++;}
 if(role==='worker'){for(const table of ['hourly_rounds','daily_competitions','daily_results','hourly_reward_pools','daily_reward_pools','reward_buffer_state'])for(const privilege of ['SELECT','INSERT','UPDATE']){check((await c.query('select has_table_privilege(current_user,$1,$2) ok',[table,privilege])).rows[0].ok,'LIFECYCLE_PRIVILEGE:'+table+':'+privilege);checked++;}check((await c.query("select has_column_privilege(current_user,'creator_fee_events','accounting_status','UPDATE') ok")).rows[0].ok,'EXISTING_REWARD_COLUMN_GRANT');checked++;}
 else{check((await c.query("select has_column_privilege(current_user,'hourly_rounds','id','UPDATE') ok")).rows[0].ok,'ROUND_ROW_LOCK_GRANT');checked++;}
 await c.query('rollback');return{role,ordinaryPrivilegesChecked:checked};
 }finally{await c.query('rollback').catch(()=>{});c.release()}
}
export async function preflight(planFile,planPin,phase='installed'){
 check(['baseline','schema-gate','installed','prepare-start'].includes(phase),'PHASE');const baselinePhase=['baseline','schema-gate'].includes(phase),plan=validatePlan(pinned(planFile,planPin)),m=verifyRelease(plan.releaseDirectory,plan.manifestSHA256);
 const r=await import(pathToFileURL(path.join(plan.releaseDirectory,m.shared)).href),template=await r.loadScope(plan.scopeFile,plan.scopeSHA256);
 let scope=template,prepared;
 check(path.dirname(plan.runtimeScopeFile)===template.controlDirectory,'RUNTIME_SCOPE_DIRECTORY');
 if(!baselinePhase&&fs.existsSync(plan.runtimeScopeFile)){prepared=readPreparedScope(plan,template,planPin);scope=r.validateScope(prepared.scope);}
 else if(phase==='installed')check(false,'PREPARED_SCOPE_REQUIRED');
 check(scope.approvalReference===plan.approvalReference,'SCOPE_APPROVAL');
 const cfg=Object.fromEntries(m.configurations.map(c=>[c.role,JSON.parse(fs.readFileSync(c.file))]));
 for(const role of ['api','worker']){const c=r.parseApplicationEnvironment(cfg[role]);check(c.PRIVATE_BETA_NON_PAYING&&c.BETA_INVITE_ONLY&&!c.PAYOUT_EXECUTION_ENABLED&&c.PAYOUT_SIGNER_TYPE==='DISABLED'&&!c.CREATOR_FEE_INGESTION_ENABLED&&c.CREATOR_FEE_SHADOW_MODE,'FINANCIAL_CONFIG');if(role==='api')check(c.API_HOST==='127.0.0.1'&&c.API_PORT===3000,'API_BINDING');}
 const urls=['api','worker','operator'].map(k=>new URL(cfg[k].DATABASE_URL));check(urls.every(u=>u.host===urls[0].host&&u.pathname===urls[0].pathname),'DATABASE_TARGET');
 for(const name of ['NODE_OPTIONS','NODE_PATH'])check(!process.env[name],'NODE_OVERRIDE');
 for(const b of plan.baseline)check(sha(b.entry)===b.entrySHA256,'BASELINE_ENTRY');
 check(sha(plan.backup.file)===plan.backup.sha256&&sha(plan.backup.restoreEvidenceFile)===plan.backup.restoreEvidenceSHA256,'BACKUP_EVIDENCE');
 const observer=r.createDatabase(cfg.operator.DATABASE_URL);try{const c=await observer.pool.connect();try{await c.query('begin isolation level repeatable read read only');
 check((await c.query('select stopped from payout_stop_state where singleton=true')).rows[0]?.stopped===true,'STOP_REQUIRED');
 if(baselinePhase){check((await c.query("select to_regnamespace('linked_candidate')::text n")).rows[0].n===null,'SCHEMA_ALREADY_PRESENT');const f=(await c.query("select pg_get_functiondef('verify_legacy_forced_fill()'::regprocedure) f")).rows[0].f;const{createHash}=await import('node:crypto');check(createHash('sha256').update(f).digest('hex')==='8f92aae5a1573517f305b1855fd60ab6f458ebdf4b9a787b857266709d77cc2d','FUNCTION_PREIMAGE');}
 if(phase==='schema-gate')check(Number((await c.query('select count(*) n from pg_stat_activity where datname=current_database() and usename=any($1::text[])',[urls.slice(0,2).map(u=>decodeURIComponent(u.username))])).rows[0].n)===0,'RUNTIME_CONNECTIONS_REMAIN');
 for(const s of scope.scopes){const a=(await c.query('select a.user_id,a.hourly_round_id,h.state,h.starts_at,h.ends_at_exclusive from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where a.id=$1',[s.accountId])).rows[0];check(a?.user_id===s.userId&&a.hourly_round_id===s.roundId,'ACCOUNT');check(+a.starts_at<=Date.now()&&(baselinePhase?(a.state==='OPEN'&&+a.ends_at_exclusive>Date.now()):['OPEN','CLOSING','SETTLING'].includes(a.state)),'ROUND_STATE');}
 await c.query('rollback');}finally{c.release()}}finally{await observer.close()}
 const roles=[],existing=new Set();for(const role of ['api','worker']){const db=r.createDatabase(cfg[role].DATABASE_URL);try{roles.push(await qualifyRuntimePrivileges(db,role));if(!baselinePhase)roles.push(await r.qualifySuccessor(db,role,path.join(plan.releaseDirectory,'runtime/worker-qualification.json')));
 if(role==='api'&&!baselinePhase)for(const s of scope.scopes)if((await db.pool.query('select 1 from linked_candidate.branches where account_id=$1 and round_id=$2',[s.accountId,s.roundId])).rowCount>0)existing.add(s.accountId);
 }finally{await db.close()}}
 // Slow integrity/catalog/privilege checks precede the fresh read. Never extend ten-second freshness.
 if(phase==='prepare-start'&&!prepared){
  check(existing.size===0,'RECOVERY_REQUIRES_EXISTING_PREPARED_SCOPE');const derived=structuredClone(template),captures=[];
  for(const s of derived.scopes){check(s.initialize&&Date.now()<=Date.parse(derived.initializeBefore),'INITIALIZATION_APPROVAL');const spec=plan.captures.find(c=>c.accountId===s.accountId);check(spec&&path.dirname(spec.file)===path.dirname(s.initialBankFile),'CAPTURE_SPEC');
   const admitted=r.validateCaptureScope(pinned(spec.scopeFile,spec.scopeSHA256));check(admitted.approvalReference===plan.approvalReference&&Date.parse(admitted.expiresAt)<=Date.parse(plan.expiresAt)&&JSON.stringify([...admitted.mints].sort())===JSON.stringify([...s.mints].sort()),'CAPTURE_APPROVAL');
   const seedRecord=pinned(spec.seedFile,spec.seedSHA256),connector=new r.FinalizedFlowConnector(r.budgetedRpc(new r.FinalizedRpc(cfg.api.SOLANA_RPC_URL,Number(cfg.api.SOLANA_RPC_TIMEOUT_MS??15000)),admitted.maxRpcCalls,Date.parse(admitted.expiresAt)),new r.FinalizedBankArchive(s.archiveDirectory),Date.now,{maxSlots:admitted.maxSlots,maxTransactions:admitted.maxTransactions});
   const evidence=await r.captureApprovedBank(seedRecord.document??seedRecord,admitted,connector);await r.publishCapture(s.initialBankFile,spec.file,evidence);s.initialBankSHA256=sha(s.initialBankFile);captures.push({accountId:s.accountId,file:spec.file,sha256:sha(spec.file)});
  }
  assertScopeProjection(template,derived);publishJson(plan.runtimeScopeFile,derived);const receipt={schema:'PAPERFUND_PREPARED_SCOPE_V1',planSHA256:planPin,templateSHA256:plan.scopeSHA256,manifestSHA256:plan.manifestSHA256,scopeSHA256:sha(plan.runtimeScopeFile),captures};publishJson(plan.runtimeScopeFile+'.receipt.json',receipt);prepared={scope:derived,receipt};scope=derived;
 }
 if(!baselinePhase){check(prepared,'PREPARED_SCOPE_REQUIRED');for(const s of scope.scopes){const evidence=prepared.receipt.captures.find(c=>c.accountId===s.accountId);check(evidence,'CAPTURE_ACCOUNT');verifyCapture(s,evidence,s.initialBankFile,Date.now(),!existing.has(s.accountId));check(sha(s.initialBankFile)===s.initialBankSHA256,'BANK_PIN');}}
 validatePlan(plan);return{qualified:true,phase,scopeCount:scope.scopes.length,financialStop:true,buyAdmission:'DENY_ALL_BUY',roles,bootstrapPerformed:false,...(prepared?{runtimeScopeFile:plan.runtimeScopeFile,runtimeScopeSHA256:prepared.receipt.scopeSHA256}:{})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(JSON.stringify(await preflight(...process.argv.slice(2))))}
