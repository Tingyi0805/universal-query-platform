// PR #99 synthetic-only Windows test ZIP builder. Never installs, reads .env,
// talks to hospital SQL, enables CHART runtime, or authorizes C:\\UQP overlay.
import {cp,mkdir,readFile,readdir,lstat,writeFile} from "node:fs/promises";
import {createReadStream,createWriteStream} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import path from "node:path";
const sha=b=>createHash("sha256").update(b).digest("hex");
const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
const out=path.resolve(process.argv[2]??"pr99-chart-test");
const evidence=JSON.parse(await readFile(process.argv[3],"utf8"));
const source=git("rev-parse","HEAD");
if(process.platform!=="win32"||process.arch!=="x64"||
   process.version!=="v24.22.1"||process.versions.modules!=="137")
  throw Error("CHART_PR99_WINDOWS_NODE24_ABI137_REQUIRED");
if(evidence.sourceCommit!==source||evidence.pr99Draft!==true||
   !/^https:\/\/github.com\/Tingyi0805\/universal-query-platform\/actions\/runs\/\d+$/.test(evidence.url))
  throw Error("CHART_PR99_STAGING_IDENTITY_INVALID");
const required=["server","client","device-lifecycle-d1-sql","windows-node24-dependencies",
  "windows-kiosk-launcher","dependency-sql-smoke","sql-924-full-schema"];
if(required.some(name=>evidence.jobs?.[name]?.result!=="success"))
  throw Error("CHART_PR99_CI_INCOMPLETE");
git("diff","--exit-code");
try{await lstat(out);throw Error("CHART_STAGING_OUTPUT_EXISTS");}
catch(e){if(e.code!=="ENOENT")throw e;}
await mkdir(out,{recursive:true});
const sources=[
  "server/dist","server/node_modules","server/package.json","server/package-lock.json",
  "client/dist","client/package.json","client/package-lock.json",
  "docs/chart-928-production-migration-release-decision.md",
];
for(const sourcePath of sources){
  const dest=path.join(out,"payload",sourcePath);
  await mkdir(path.dirname(dest),{recursive:true});
  await cp(sourcePath,dest,{recursive:true,dereference:false});
}
await cp("tools/verify-pr99-chart-test.mjs",path.join(out,"verify-pr99-chart-test.mjs"));
await writeFile(path.join(out,"README-TEST-ONLY.txt"),[
  "UQP PR #99 — WINDOWS x64 SYNTHETIC-ONLY TEST ARCHIVE",
  "This archive is NOT an installer, NOT a production release, and NOT permission to overwrite C:\\UQP.",
  "CHART SQL 928 is NOT included; no SQL scripts are executed. CHART create and public/device playback remain hard OFF.",
  "No .env credentials or patient data are included. Extraction runs no commands.",
  "For independent isolated Windows testing only. Never copy this payload into a working hospital system.",
  "Node.js 24.22.1, ABI 137, Windows x64 required for native runtime.",
  "Verify extracted checksums with: node verify-pr99-chart-test.mjs <extracted-folder>",
  "A separate formal change approval, reviewed 928 migration, Signer/Writer authorization and IIS UAT",
  "are mandatory before considering any real C:\\UQP deployment.",
].join("\n")+"\n");
const files=[];
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name),rel=path.relative(out,full).split(path.sep).join("/");
    if(entry.isSymbolicLink())throw Error("CHART_STAGING_SYMLINK_FORBIDDEN");
    if(/(^|\/)(\.env($|\.)|\.npmrc$|\.git($|\/))|\.(pfx|pem|key)$/i.test(rel)||
       /[\r\n:]/.test(rel))throw Error("CHART_STAGING_SECRET_OR_INVALID_PATH");
    if(entry.isDirectory())await walk(full);
    else if(entry.isFile()){
      const data=await readFile(full);
      files.push({path:rel,bytes:data.length,sha256:sha(data)});
    }else throw Error("CHART_STAGING_UNSUPPORTED_ENTRY");
  }
}
await walk(out);
files.sort((a,b)=>a.path.localeCompare(b.path,"en"));
const manifest={
  format:"UQP_PR99_CHART_SYNTHETIC_WINDOWS_TEST_V1",sourceCommit:source,
  sourceTree:git("rev-parse","HEAD^{tree}"),
  runtime:{platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules},
  approval:"TEST_ONLY_NOT_AUTHORIZED_FOR_DEPLOYMENT",
  chartCreateEnabled:false,publicPlaybackEnabled:false,contains928Sql:false,
  sqlActionsOnExtract:"NONE",ci:evidence,files,
};
const body=Buffer.from(JSON.stringify(manifest,null,2)+"\n");
await writeFile(path.join(out,"manifest.json"),body);
await writeFile(path.join(out,"SHA256SUMS.txt"),
  [...files.map(f=>f.sha256+"  "+f.path),sha(body)+"  manifest.json"].join("\n")+"\n");
const require=createRequire(path.resolve("server/package.json"));
const archiver=require("archiver");
const stream=createWriteStream(out+".zip"),archive=archiver("zip",{zlib:{level:6}});
await new Promise((resolve,reject)=>{
  stream.on("close",resolve);stream.on("error",reject);
  archive.on("warning",reject);archive.on("error",reject);
  archive.pipe(stream);archive.directory(out,false);archive.finalize().catch(reject);
});
const digest=createHash("sha256");
for await(const chunk of createReadStream(out+".zip"))digest.update(chunk);
await writeFile(out+".zip.sha256",digest.digest("hex")+"  "+path.basename(out)+".zip\n");
console.log("CHART_PR99_WINDOWS_SYNTHETIC_TEST_PACKAGE_CREATED:"+source+":files="+files.length);
