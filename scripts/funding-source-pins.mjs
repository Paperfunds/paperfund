import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';
const out=new URL('../../evidence/official/',import.meta.url);mkdirSync(out,{recursive:true});
const r=await fetch('https://api.github.com/repos/pump-fun/pump-public-docs/commits/main',{headers:{'user-agent':'Paperfund-readonly-verification'}});if(!r.ok)throw Error('OFFICIAL_COMMIT_UNAVAILABLE');const commit=await r.json();const pins=[];
for(const path of ['idl/pump.json','idl/pump_amm.json','idl/pump_fees.json','docs/instructions/COLLECT_CREATOR_FEE.md','docs/instructions/CREATOR_FEE_SHARING.md','docs/HOLDER_REWARDS_README.md']){
 const url=`https://raw.githubusercontent.com/pump-fun/pump-public-docs/${commit.sha}/${path}`,res=await fetch(url);if(!res.ok)throw Error('OFFICIAL_SOURCE_MISSING:'+path);const bytes=Buffer.from(await res.arrayBuffer()),file=path.replaceAll('/','__');writeFileSync(new URL(file,out),bytes,{flag:'wx'});pins.push({path,file,url,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const name of ['pump-sdk','pump-swap-sdk']){const path=`node_modules/@pump-fun/${name}/package.json`,pkg=JSON.parse(readFileSync(path));pins.push({installedPackage:name,version:pkg.version,packageJsonSha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}
writeFileSync(new URL('pins.json',out),JSON.stringify({commit:commit.sha,pins},null,2));console.log(commit.sha);
