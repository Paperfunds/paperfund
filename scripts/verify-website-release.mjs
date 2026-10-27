import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/website-redesign/manifest.json')));
for(const entry of manifest.files){
 const target=path.resolve(root,entry.path);
 if(!target.startsWith(root+path.sep)||entry.path.includes('..'))throw Error('INVALID_WEBSITE_RELEASE_PATH');
 const actual=createHash('sha256').update(fs.readFileSync(target)).digest('hex');
 if(actual!==entry.sha256)throw Error('WEBSITE_RELEASE_CHANGED:'+entry.path);
}
console.log('Verified '+manifest.files.length+' staged website files. No deployment or process changes.');
