// Verify extracted PR #99 test ZIP without SQL, services, network or deployment.
import {readFile,readdir,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
const root=path.resolve(process.argv[2]??".");
const fail=reason=>{throw Error("CHART_PR99_TEST_PACKAGE_INVALID:"+reason);};
const sha=b=>createHash("sha256").update(b).digest("hex");
const manifest=JSON.parse(await readFile(path.join(root,"manifest.json"),"utf8"));
if(manifest.format!=="UQP_PR99_CHART_SYNTHETIC_WINDOWS_TEST_V1"||
   !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||
   manifest.approval!=="TEST_ONLY_NOT_AUTHORIZED_FOR_DEPLOYMENT"||
   manifest.chartCreateEnabled!==false||manifest.publicPlaybackEnabled!==false||
   manifest.contains928Sql!==false||manifest.sqlActionsOnExtract!=="NONE")
  fail("MANIFEST_POLICY");
const sums=await readFile(path.join(root,"SHA256SUMS.txt"),"utf8");
const expected=new Map();
for(const line of sums.trimEnd().split("\n")){
  const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
  if(!match)fail("CHECKSUM_FORMAT");
  const rel=match[2];
  if(!rel||rel.startsWith("/")||rel.includes("\\")||rel.includes(":")||
     rel.split("/").some(part=>part==="."||part===".."||!part)||
     expected.has(rel))fail("CHECKSUM_PATH");
  expected.set(rel,match[1]);
}
const actual=new Set();
async function walk(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name),rel=path.relative(root,full).split(path.sep).join("/");
    const info=await lstat(full);
    if(info.isSymbolicLink())fail("SYMLINK");
    if(info.isDirectory())await walk(full);
    else if(info.isFile()){
      if(rel==="SHA256SUMS.txt")continue;
      if(!expected.has(rel))fail("UNMANIFESTED_FILE");
      if(sha(await readFile(full))!==expected.get(rel))fail("FILE_DIGEST");
      actual.add(rel);
    }else fail("FILE_TYPE");
  }
}
await walk(root);
if(actual.size!==expected.size)fail("FILE_COUNT");
if(sha(await readFile(path.join(root,"manifest.json")))!==expected.get("manifest.json"))
  fail("MANIFEST_DIGEST");
if(!Array.isArray(manifest.files)||manifest.files.length+1!==actual.size)fail("FILE_MANIFEST_COUNT");
for(const file of manifest.files){
  if(!actual.has(file.path)||file.sha256!==expected.get(file.path))fail("MANIFEST_FILE");
  const info=await lstat(path.join(root,file.path));
  if(info.size!==file.bytes)fail("MANIFEST_BYTES");
}
for(const rel of [
 "payload/server/dist/server.js","payload/client/dist/index.html",
 "payload/server/package.json","README-TEST-ONLY.txt","verify-pr99-chart-test.mjs",
]){
 if(!actual.has(rel))fail("REQUIRED_FILE_MISSING");
}
if([...actual].some(rel=>/(^|\/)(\.env($|\.)|\.npmrc$|\.git($|\/))|\.(pfx|pem|key)$/i.test(rel)||
   /(^|\/)database\/migrations\//.test(rel)))fail("FORBIDDEN_PAYLOAD");
console.log("CHART_PR99_TEST_PACKAGE_HASHES_PASS:"+manifest.sourceCommit+":files="+manifest.files.length);
console.log("TEST_ONLY_NOT_AUTHORIZED_FOR_DEPLOYMENT");
