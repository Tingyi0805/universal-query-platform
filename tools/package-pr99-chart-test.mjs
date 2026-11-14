// PR #99 authorized Windows test ZIP builder. Extraction never installs SQL,
// reads .env, enables CHART runtime or deploys the application.
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
  "docs/chart-928-authorized-test-operations.md",
  "database/authorized-test",
  // Read-only preflight dependencies, outside the generic Migration runner.
  "database/acceptance/chart-928-adoption-preflight-readonly.sql",
  "tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql",
];
for(const sourcePath of sources){
  const dest=path.join(out,"payload",sourcePath);
  await mkdir(path.dirname(dest),{recursive:true});
  await cp(sourcePath,dest,{recursive:true,dereference:false});
}
await cp("tools/verify-pr99-chart-test.mjs",path.join(out,"verify-pr99-chart-test.mjs"));
await writeFile(path.join(out,"README-TEST-ONLY.txt"),[
  "UQP PR #99 — WINDOWS x64 AUTHORIZED TEST ARCHIVE",
  "This is a TEST release only. Manually back up C:\\UQP and the approved target database before copying payload. Never auto-deploy.",
  "Separate guarded 928 test sources are included under payload/database/authorized-test. Extraction executes NOTHING. Production gates stay OFF.",
  "No .env credentials or patient data are included. Extraction runs no commands.",
  "Keep the existing .env. Follow payload/docs/chart-928-authorized-test-operations.md for explicit test-target authorization and SQL preflight/apply/verify.",
  "Node.js 24.22.1, ABI 137, Windows x64 required for native runtime.",
  "Verify extracted checksums with: node verify-pr99-chart-test.mjs <extracted-folder>",
  "Option A uses the existing SQL Pool and verified JWT Actor. No extra SQL login, Signer or Issuer.",
  "This archive is not production approval. Use only an expressly authorized test target; production deployment remains forbidden.",
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
  format:"UQP_PR99_CHART_AUTHORIZED_WINDOWS_TEST_V2",sourceCommit:source,
  sourceTree:git("rev-parse","HEAD^{tree}"),
  runtime:{platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules},
  approval:"TEST_ONLY_NOT_AUTHORIZED_FOR_DEPLOYMENT",
  chartCreateEnabled:false,publicPlaybackEnabled:false,contains928Sql:true,
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
console.log("CHART_PR99_WINDOWS_AUTHORIZED_TEST_PACKAGE_CREATED:"+source+":files="+files.length);
