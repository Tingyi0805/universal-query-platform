// CI-only Windows/x64 release. Does not connect to SQL or read deployment configuration.
import {cp,mkdir,readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.resolve(process.argv[2]??'release926'),evidence=JSON.parse(await readFile(process.argv[3],'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
git('diff','--exit-code');
const source=git('rev-parse','HEAD'),migration='f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43';
if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v24.22.1'||process.versions.modules!=='137')throw Error('WINDOWS_NODE24_22_1_ABI137_X64_REQUIRED');
if(!/^[a-f0-9]{40}$/.test(evidence.pr66Head)||evidence.sourceCommit!==source||evidence.pr83Draft!==true||!/^https:\/\/github.com\/Tingyi0805\/universal-query-platform\/actions\/runs\/\d+$/.test(evidence.url))throw Error('RELEASE_IDENTITY_INVALID');
git('merge-base','--is-ancestor',evidence.pr66Head,source);
const [behind,ahead]=git('rev-list','--left-right','--count',`${evidence.pr66Head}...${source}`).split(/\s+/).map(Number);
const jobs=['server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke'];
if(behind!==0||jobs.some(k=>evidence.jobs?.[k]?.result!=='success'))throw Error('RELEASE_CI_OR_BASELINE_BLOCKED');
if(sha(await readFile('database/migrations/926_dashboard_device_lifecycle.sql'))!==migration)throw Error('926_SOURCE_CHANGED');
try{await lstat(out);throw Error('RELEASE_OUTPUT_MUST_BE_NEW');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out,{recursive:true});
const sources=['server/dist','server/src','server/node_modules','server/package.json','server/package-lock.json','server/tsconfig.json','server/tsconfig.build.json','client/dist','client/src','client/package.json','client/package-lock.json','client/index.html','client/vite.config.ts','client/tsconfig.json','client/tsconfig.app.json','client/tsconfig.node.json','client/tsconfig.e2e.json','database/migrations','database/drafts/924_dataset_security_scope_binding.sql','tools/sqlserver-acceptance/drafts','docs/dashboard-device-lifecycle-d5-c6.md','docs/dashboard-d6-3-acceptance.md','docs/dashboard-d6-3-second-round.md','tools/test-pr83-node-runtime.mjs'];
for(const rel of sources){const dest=path.join(out,'payload',rel);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(root,rel),dest,{recursive:true,dereference:false});}
await cp('tools/verify-uqp-pr83-926.ps1',path.join(out,'verify-uqp-pr83-926.ps1'));
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const absolute=path.join(dir,e.name),rel=path.relative(out,absolute).split(path.sep).join('/');
 if(e.isSymbolicLink())throw Error('RELEASE_LINK_FORBIDDEN');
 if(/(^|\/)(\.env($|\.)|\.npmrc$|\.git($|\/))|\.(pfx|pem|key)$/i.test(rel)||/[\r\n:]/.test(rel))throw Error(`RELEASE_FORBIDDEN_FILE:${rel}`);
 if(e.isDirectory())await walk(absolute);else{const b=await readFile(absolute);files.push({path:rel,bytes:b.length,sha256:sha(b)});}
}}
await walk(out);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const manifest={format:'UQP_PR83_926_RELEASE_V1',sourceCommit:source,sourceTree:git('rev-parse','HEAD^{tree}'),pr66Head:evidence.pr66Head,pr66Comparison:{ahead,behind},migration926Sha256:migration,
 runtime:{node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch},ci:evidence,
 approvalStatus:'BLOCKED_PENDING_MANUAL_ACCEPTANCE',databaseActionsOnExtract:'NONE',preserve:['.env','all existing business files','all existing business data','AuditLog and archives'],files};
const body=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(path.join(out,'manifest.json'),body);
await writeFile(path.join(out,'SHA256SUMS.txt'),[...files.map(f=>`${f.sha256}  ${f.path}`),`${sha(body)}  manifest.json`].join('\n')+'\n');
const require=createRequire(path.join(root,'server/package.json')),archiver=require('archiver');
const zip=out+'.zip',stream=createWriteStream(zip),archive=archiver('zip',{zlib:{level:6}});
await new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('warning',reject);archive.on('error',reject);archive.pipe(stream);archive.directory(out,false);archive.finalize().catch(reject);});
// Streaming hash avoids loading the Windows runtime ZIP into memory.
const {createReadStream}=await import('node:fs');const hash=createHash('sha256');for await(const chunk of createReadStream(zip))hash.update(chunk);
await writeFile(zip+'.sha256',hash.digest('hex')+'  '+path.basename(zip)+'\n');
console.log(`PR83_926_RELEASE_STAGING_ONLY:${source}:files=${files.length}:manifest=${sha(body)}`);
