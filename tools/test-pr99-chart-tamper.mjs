// Run the verifier on an intentionally tampered ZIP extraction.
// The verifier's nonzero exit is the EXPECTED security result; PowerShell
// must not mistake that expected rejection for a test runner crash.
import {spawnSync} from "node:child_process";
import path from "node:path";
const root=process.argv[2];
if(!root)throw Error("CHART_PR99_TAMPER_TEST_PATH_REQUIRED");
const child=spawnSync(process.execPath,
  ["tools/verify-pr99-chart-test.mjs",path.resolve(root)],
  {encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
if(child.error)throw child.error;
if(child.status===null||child.signal)throw Error("CHART_PR99_TAMPER_TEST_EXECUTION_FAILED");
if(child.status===0)throw Error("CHART_PR99_TAMPER_NOT_REJECTED");
if(!String(child.stderr).includes("CHART_PR99_TEST_PACKAGE_INVALID:FILE_DIGEST"))
  throw Error("CHART_PR99_TAMPER_REJECTED_FOR_UNEXPECTED_REASON");
console.log("CHART_PR99_TAMPER_REJECTED_AS_EXPECTED");
