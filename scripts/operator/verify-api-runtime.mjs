import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyApiRuntime(root,manifestPath,expectedHash){
 const file=path.resolve(root,manifestPath);if(manifestPath!=='docs/operator-candidate/runtime-revision-v2/api-build.json'||! /^[a-f0-9]{64}$/i.test(expectedHash??''))throw Error('API_REVIEWED_BUILD_PROFILE_REQUIRED');
 const raw=fs.readFileSync(file);if(sha(raw)!==expectedHash.toLowerCase())throw Error('API_RUNTIME_MANIFEST_CHANGED');const m=JSON.parse(raw);
 if(m.schema!=='paperfund-reviewed-api-runtime-v1'||m.entry!=='apps/api/dist/main.js'||!m.files.length)throw Error('API_RUNTIME_MANIFEST_INVALID');
 for(const f of [...m.files,...m.acceptedSources]){if(!/^(apps\/api\/(dist\/|src\/|package.json$)|packages\/[^/]+\/(dist\/|src\/|package.json$)|packages\/db\/migrations\/\d[^/]+\.sql$|package-lock.json$)/.test(f.path)||f.path.includes('..')||f.path.includes('\\'))throw Error('API_RUNTIME_PATH_INVALID');const target=path.resolve(root,f.path);if(!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep)||sha(fs.readFileSync(target))!==f.sha256)throw Error('API_DEPLOYED_FILE_CHANGED:'+f.path);}
 for(const name of ['config','core','db','execution','protocols','shared'])if(fs.realpathSync(path.join(root,'node_modules/@paperfund',name))!==fs.realpathSync(path.join(root,'packages',name)))throw Error('API_WORKSPACE_RESOLUTION_CHANGED');
 return {verified:true,service:'api',runtimeFiles:m.files.length,acceptedSources:m.acceptedSources.length,financialAuthority:'NONE',migrationsRun:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyApiRuntime(process.cwd(),process.argv[2],process.argv[3])));}catch(e){console.error(/^[A-Z0-9_]+(?::[a-zA-Z0-9_./-]+)?$/.test(e.message)?e.message:'API_RUNTIME_VERIFICATION_FAILED');process.exitCode=1;}}
