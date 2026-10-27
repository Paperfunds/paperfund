import {fileURLToPath} from 'node:url';import fs from 'node:fs';import path from 'node:path';import{verifyRelease,hash}from './website-artifact-release.mjs';
export function installImage(image,target){
 const files=[];function walk(dir,relative=''){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const rel=path.join(relative,d.name);if(d.isDirectory())walk(path.join(dir,d.name),rel);else if(d.isFile())files.push(rel);else throw Error('IMAGE_LINK_REFUSED')}}walk(image);
 if(!files.includes('index.html'))throw Error('IMAGE_INDEX_REQUIRED');
 for(const rel of [...files.filter(f=>f!=='index.html'),'index.html']){const from=path.join(image,rel),to=path.join(target,rel);fs.mkdirSync(path.dirname(to),{recursive:true});const tmp=to+'.paperfund-install';fs.copyFileSync(from,tmp);if(hash(tmp)!==hash(from))throw Error('COPY_INTEGRITY_FAILED');fs.renameSync(tmp,to)}
 for(const rel of files)if(hash(path.join(image,rel))!==hash(path.join(target,rel)))throw Error('INSTALLED_HASH_FAILED');return files.length;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[release,mode]=process.argv.slice(2);const r=verifyRelease(release);if(!['install','rollback'].includes(mode))throw Error('INSTALL_OR_ROLLBACK_REQUIRED');const image=mode==='install'?path.join(release,'web'):path.join(r.backupDirectory,'rollback/web-dist');console.log(JSON.stringify({mode,files:installImage(image,path.resolve('apps/web/dist')),processRestarted:false}));}
