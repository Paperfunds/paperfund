import {chromium} from '@playwright/test';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const session=JSON.parse(await readFile('logs/operator/session.json','utf8')),base='http://127.0.0.1:3188';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1400,height:1100}});const errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
try{
 assert.equal((await page.request.post(base+'/session',{headers:{origin:base},data:{token:new URL(session.url).hash.slice(1)}})).status(),200);
 await page.goto(base+'/');await page.getByText('Direct loopback session. No financial authorization granted.').waitFor();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/claim-plan'));
 await page.getByRole('button',{name:'Prepare & simulate creator claim',exact:true}).click();
 const result=await response;assert.equal(result.status(),200);
 await page.waitForFunction(()=>document.getElementById('claim-detail').textContent.includes('unsignedTransactionBase64'));
 const envelope=JSON.parse(await page.locator('#claim-detail').textContent());
 assert.equal(envelope.review.simulation.error,null);assert.equal(envelope.review.simulation.grossVerified,true);assert.equal(envelope.review.maximumFeeLamports,'5000');assert.equal(envelope.review.authorization,'NONE');assert.equal(envelope.review.signature,null);assert.match(await page.locator('#claim-signer').textContent(),/DPAPI: available/);
 assert(await page.getByRole('button',{name:'Execute — separate exact transaction approval required',exact:true}).isDisabled());
 assert.equal((await page.request.post(base+'/api/sign',{headers:{origin:base},data:{}})).status(),423);
 assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/operator/claim-dashboard.png',fullPage:true});
 await writeFile('artifacts/operator/claim-browser-smoke.json',JSON.stringify({passed:true,simulationSuccessful:true,approvalAndExecutionBlocked:true,messageSha256:envelope.review.messageSha256,reviewSha256:envelope.reviewSha256,expiresAt:envelope.review.expiresAt,errors,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({passed:true,messageSha256:envelope.review.messageSha256,gross:envelope.review.expectedGrossLamports,fee:envelope.review.feeLamports,expiresAt:envelope.review.expiresAt}));
}finally{await browser.close();}
