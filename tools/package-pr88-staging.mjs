// PR88 CI-only Windows/x64 TEST staging. No SQL/deployment/configuration access.
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
const source=git('rev-parse','HEAD'),pr83Baseline='846483f6b1151eb12468d60369745fe77f0249b7',migration='f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43';
if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v24.22.1'||process.versions.modules!=='137')throw Error('WINDOWS_NODE24_22_1_ABI137_X64_REQUIRED');
if(evidence.pr83Baseline!==pr83Baseline||evidence.sourceCommit!==source||evidence.pr88Draft!==true||!/^https:\/\/github.com\/Tingyi0805\/universal-query-platform\/actions\/runs\/\d+$/.test(evidence.url))throw Error('PR88_STAGING_IDENTITY_INVALID');
git('merge-base','--is-ancestor',pr83Baseline,source);
const [behind,ahead]=git('rev-list','--left-right','--count',`${pr83Baseline}...${source}`).split(/\s+/).map(Number);
const changes=git('diff','--name-only',pr83Baseline,source).split(/\r?\n/).filter(Boolean);
const allowedTools=new Set(['tools/package-pr88-staging.mjs','tools/verify-uqp-pr88-staging.ps1','tools/test-uqp-pr88-staging.ps1']);
if(changes.some(p=>!(p.startsWith('client/')||p.startsWith('docs/')||p==='.github/workflows/ci.yml'||allowedTools.has(p))))throw Error('PR88_SERVER_DATABASE_CHANGE_BLOCKED');
const jobs=['server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke'];
if(behind!==0||jobs.some(k=>evidence.jobs?.[k]?.result!=='success'))throw Error('PR88_STAGING_CI_OR_BASELINE_BLOCKED');
if(sha(await readFile('database/migrations/926_dashboard_device_lifecycle.sql'))!==migration)throw Error('926_SOURCE_CHANGED');
try{await lstat(out);throw Error('RELEASE_OUTPUT_MUST_BE_NEW');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out,{recursive:true});
const sources=['server/dist','server/src','server/node_modules','server/package.json','server/package-lock.json','server/tsconfig.json','server/tsconfig.build.json','client/dist','client/src','client/package.json','client/package-lock.json','client/index.html','client/vite.config.ts','client/tsconfig.json','client/tsconfig.app.json','client/tsconfig.node.json','client/tsconfig.e2e.json','database/migrations','database/drafts/924_dataset_security_scope_binding.sql','tools/sqlserver-acceptance/drafts','docs/dashboard-device-lifecycle-d5-c6.md','docs/dashboard-d6-3-acceptance.md','docs/dashboard-d6-3-second-round.md','tools/test-pr83-node-runtime.mjs'];
for(const rel of sources){const dest=path.join(out,'payload',rel);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(root,rel),dest,{recursive:true,dereference:false});}
await cp('tools/verify-uqp-pr88-staging.ps1',path.join(out,'verify-uqp-pr88-staging.ps1'));
await writeFile(path.join(out,'README-PR88-WINDOWS-TEST-STAGING.txt'),[
 'UQP PR #88 - FULL WINDOWS TEST STAGING ONLY',
 'This archive contains matching Windows x64 Server and Client binaries built from the same Git commit.',
 'It is NOT a production release, not an installer, and not authorization to overwrite C:\\UQP.',
 'The payload/ folder mirrors the UQP runtime directory structure. Files are not installed on extraction.',
 'Node v24.22.1 / ABI 137 / win32 x64 is mandatory for bundled native modules.',
 'Keep existing .env configuration and all business data; the package contains no .env and runs no migrations.',
 'Production SQL schema compatibility, dashboard device policy and current deployed version are NOT asserted.',
 'CHART stays synthetic-only. No live patient-data CHART authorization or playback is enabled by this archive.',
 'Only an authorized, manually backed-up and independently checked test deployment may copy from payload/.',
 'Check manifest.json and SHA256SUMS.txt with verify-uqp-pr88-staging.ps1 before any authorized use.',
 'If current C:\\UQP differs from the pinned PR83 baseline, stop and reconcile rather than overwrite.',
].join('\\n')+'\\n');
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const absolute=path.join(dir,e.name),rel=path.relative(out,absolute).split(path.sep).join('/');
 if(e.isSymbolicLink())throw Error('RELEASE_LINK_FORBIDDEN');
 if(/(^|\/)(\.env($|\.)|\.npmrc$|\.git($|\/))|\.(pfx|pem|key)$/i.test(rel)||/[\r\n:]/.test(rel))throw Error(`RELEASE_FORBIDDEN_FILE:${rel}`);
 if(e.isDirectory())await walk(absolute);else{const b=await readFile(absolute);files.push({path:rel,bytes:b.length,sha256:sha(b)});}
}}
await walk(out);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const manifest={format:'UQP_PR88_WINDOWS_TEST_STAGING_V1',sourceCommit:source,sourceTree:git('rev-parse','HEAD^{tree}'),pr83Baseline,pr83Comparison:{ahead,behind},changedFiles:changes,migration926Sha256:migration,
 runtime:{node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch},ci:evidence,
 approvalStatus:'TEST_ONLY_NO_DEPLOYMENT_AUTHORIZATION',databaseActionsOnExtract:'NONE',liveChartEnabled:false,preserve:['.env','all existing business files','all existing business data','AuditLog and archives'],files};
const body=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(path.join(out,'manifest.json'),body);
await writeFile(path.join(out,'SHA256SUMS.txt'),[...files.map(f=>`${f.sha256}  ${f.path}`),`${sha(body)}  manifest.json`].join('\n')+'\n');
const require=createRequire(path.join(root,'server/package.json')),archiver=require('archiver');
const zip=out+'.zip',stream=createWriteStream(zip),archive=archiver('zip',{zlib:{level:6}});
await new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('warning',reject);archive.on('error',reject);archive.pipe(stream);archive.directory(out,false);archive.finalize().catch(reject);});
// Streaming hash avoids loading the Windows runtime ZIP into memory.
const {createReadStream}=await import('node:fs');const hash=createHash('sha256');for await(const chunk of createReadStream(zip))hash.update(chunk);
await writeFile(zip+'.sha256',hash.digest('hex')+'  '+path.basename(zip)+'\n');
console.log(`PR88_WINDOWS_TEST_STAGING_ONLY:${source}:files=${files.length}:manifest=${sha(body)}`);
