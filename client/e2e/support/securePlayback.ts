import {test as base, expect} from "@playwright/test";
import {spawn} from "node:child_process";
import path from "node:path";

// Actual TLS on loopback, synthetic API only. The test certificate exception
// belongs to these contexts and never changes application transport validation.
export const test = base.extend<{}, {secureOrigin:string}>({
  secureOrigin: [async ({}, use) => {
    const fixture=spawn(process.execPath,["--import","tsx","src/modules/dashboard/dashboardKiosk.testFixture.ts","--serve-kiosk-fixture"],{cwd:path.resolve("../server"),stdio:["ignore","pipe","pipe"]});
    try {
      const port=await new Promise<number>((resolve,reject)=>{
        let output="";
        fixture.stdout!.on("data",data=>{output+=data.toString();if(/^\d+\n/.test(output))resolve(Number(output.trim()));});
        fixture.on("error",reject);fixture.on("exit",()=>reject(new Error("Synthetic TLS fixture stopped")));
      });
      await use(`https://127.0.0.1:${port}`);
    } finally {fixture.kill();}
  }, {scope:"worker"}],
  baseURL: async ({secureOrigin},use)=>use(secureOrigin),
  ignoreHTTPSErrors: true,
});
export {expect};
export type {Page} from "@playwright/test";
