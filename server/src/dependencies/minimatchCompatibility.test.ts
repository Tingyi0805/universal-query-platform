import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp,mkdir,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { applyDatasetDeliveryPolicy } from "../modules/dataset/datasetDeliveryPolicy.js";
import { createQueryExcel } from "../modules/export/excelExport.service.js";
const require=createRequire(import.meta.url),excel=createRequire(require.resolve("exceljs"));
const archiveRequire=createRequire(excel.resolve("archiver")),zipRequire=createRequire(archiveRequire.resolve("zip-stream"));
const readdirRequire=createRequire(archiveRequire.resolve("readdir-glob"));
const utilities=[archiveRequire,zipRequire].map(parent=>createRequire(parent.resolve("archiver-utils")));
const normalize=(values:string[])=>values.map(v=>v.replaceAll("\\","/")).sort();
async function fixture(t:import("node:test").TestContext){
 const dir=await mkdtemp(path.join(tmpdir(),"uqp-d1s 中文 "));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const name of ["中文 報表.xlsx","root.txt","file[1].txt",".hidden.txt","nested/保留.txt","nested/skip.txt","other/child.xlsx"]){
  await mkdir(path.dirname(path.join(dir,name)),{recursive:true});await writeFile(path.join(dir,name),`synthetic:${name}`);
 }return dir;
}
for(const [index,utility]of utilities.entries())test(`compat actual archiver-utils ${index} glob.sync, filters, exclusions and mapping`,async t=>{
 const dir=await fixture(t),files=utility("./file.js");
 assert.deepEqual(normalize(files.expand({cwd:dir,nodir:true},["**/*.{txt,xlsx}","!**/skip.txt"])),["file[1].txt","nested/保留.txt","other/child.xlsx","root.txt","中文 報表.xlsx"].sort());
 assert.deepEqual(normalize(files.expand({cwd:dir,dot:true,filter:"isFile"},["*.txt","!root.txt"])),[".hidden.txt","file[1].txt"]);
 assert.deepEqual(normalize(files.expand({cwd:dir,filter:(file:string)=>file.endsWith(".xlsx")},"**/*")),["other/child.xlsx","中文 報表.xlsx"].sort());
 assert.deepEqual(files.expand({cwd:dir},"does-not-exist-*"),[]);
 const mapping=files.expandMapping(["**/*.xlsx"],"out",{cwd:dir,flatten:true,ext:".zip"});
 assert.deepEqual(normalize(mapping.map((x:any)=>x.dest)),["out/child.zip","out/中文 報表.zip"].sort());
 assert(mapping.every((x:any)=>x.src.every((s:string)=>s.replaceAll("\\","/").startsWith(dir.replaceAll("\\","/")+"/"))));
});
test("compat readdir-glob Minimatch constructor/match, ignore, skip, dot, arrays and nocase",async t=>{
 const dir=await fixture(t),walk=archiveRequire("readdir-glob");
 const collect=(options:Record<string,unknown>)=>new Promise<string[]>((resolve,reject)=>{
  const result:string[]=[];const stream=walk(dir,options);stream.on("match",(file:any)=>{assert.equal(typeof file.absolute,"string");result.push(file.relative);});stream.once("error",reject);stream.once("end",()=>resolve(normalize(result)));
 });
 assert.deepEqual(await collect({pattern:["**/*.TXT","**/*.xlsx"],nocase:true,nodir:true,ignore:"**/skip.txt",skip:"other",dot:true}),[".hidden.txt","file[1].txt","nested/保留.txt","root.txt","中文 報表.xlsx"].sort());
 assert.deepEqual(await collect({pattern:"*.txt",matchBase:true,nodir:true,ignore:"**/skip.txt"}),["file[1].txt","nested/保留.txt","root.txt"].sort());
});
test("compat actual Archiver glob/directory ZIP preserves Unicode paths and readable contents",async t=>{
 const dir=await fixture(t),archive=excel("archiver")("zip",{zlib:{level:6}}),chunks:Buffer[]=[];
 const finished=new Promise<Buffer>((resolve,reject)=>{archive.on("data",(b:Buffer)=>chunks.push(b));archive.once("error",reject);archive.once("end",()=>resolve(Buffer.concat(chunks)));});
 archive.glob("**/*.txt",{cwd:dir,dot:true,ignore:"**/skip.txt"});archive.directory(path.join(dir,"other"),"映射");await archive.finalize();
 const zip=await excel("unzipper").Open.buffer(await finished),names=zip.files.map((file:any)=>file.path).sort();
 assert.deepEqual(names,[".hidden.txt","file[1].txt","nested/保留.txt","root.txt","映射/child.xlsx"].sort());
 const entry=zip.files.find((f:any)=>f.path==="nested/保留.txt");assert.equal((await entry.buffer()).toString(),"synthetic:nested/保留.txt");
 await assert.rejects(excel("unzipper").Open.buffer(Buffer.from("invalid synthetic zip")));
});
test("compat real masking -> XLSX bytes -> readback preserves Chinese/date/number and excludes raw patient data",async()=>{
 const date=new Date("2026-10-31T00:30:45.000Z"),names=["NAME","MRN","AMOUNT","DATE"],rawName="王小明",rawId="SYNTHETIC-PATIENT-KEY-ONLY";
 const masked=applyDatasetDeliveryPolicy({policy:{state:"CONFIRMED",version:"1",rules:[{columnName:"NAME",mode:"CUSTOM",customMask:{prefix:1,suffix:1,symbol:"○"}},{columnName:"MRN",mode:"OMIT"},{columnName:"AMOUNT",mode:"NONE"},{columnName:"DATE",mode:"NONE"}]},columns:names.map(name=>({name})),rows:[{NAME:rawName,MRN:rawId,AMOUNT:1234567.25,DATE:date}]});
 const reports:any[]=masked.columns.map((c,i)=>({columnName:c.name,displayLabel:({NAME:"姓名",AMOUNT:"金額",DATE:"時間"} as Record<string,string>)[c.name],displayOrder:i,isVisible:true,width:160,displayFormat:c.name==="DATE"?"yyyy-mm-dd hh:mm:ss":c.name==="AMOUNT"?"#,##0.00":null,alignment:"LEFT",groupOrder:null,aggregateType:"NONE"}));
 const bytes=await createQueryExcel("病患/報表",{columns:masked.columns,rows:masked.rows,rowCount:1,truncated:false,elapsedMs:0},reports);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);const sheet=workbook.worksheets[0]!;
 assert.equal(sheet.name,"病患_報表");assert.deepEqual([sheet.getCell("A1").value,sheet.getCell("B1").value,sheet.getCell("C1").value],["姓名","金額","時間"]);
 assert.equal(sheet.columnCount,3);assert.equal(sheet.getCell("A2").value,"王○明");assert.equal(sheet.getCell("B2").value,1234567.25);assert.equal(sheet.getCell("B2").numFmt,"#,##0.00");assert.equal((sheet.getCell("C2").value as Date).toISOString(),date.toISOString());
 const archive=await excel("unzipper").Open.buffer(bytes);
 for(const file of archive.files.filter((f:any)=>/\.(?:xml|rels)$/.test(f.path))){const xml=(await file.buffer()).toString();assert(!xml.includes(rawName));assert(!xml.includes(rawId));}
});
test("compat streaming XLSX uses actual Archiver and unzipper.Parse(forceStream), preserving multiple rows",async t=>{
 const dir=await fixture(t),file=path.join(dir,"串流 報表.xlsx"),date=new Date("2026-10-31T01:02:03.000Z");
 const writer=new ExcelJS.stream.xlsx.WorkbookWriter({filename:file,useSharedStrings:true,useStyles:true}),sheet=writer.addWorksheet("串流");
 for(let i=0;i<120;i++)sheet.addRow([`合○資料${i}`,i+0.25,date]).commit();await writer.commit();assert((await readFile(file)).length>100);
 let count=0;for await(const ws of new ExcelJS.stream.xlsx.WorkbookReader(file,{sharedStrings:"cache",styles:"cache",worksheets:"emit"})){
  for await(const row of ws){assert.equal(row.getCell(1).value,`合○資料${count}`);assert.equal(row.getCell(2).value,count+0.25);assert.equal((row.getCell(3).value as Date).toISOString(),date.toISOString());count++;}
 }assert.equal(count,120);
});
test("security all installed matcher paths resolve to 11.0.3, with actual caller exports",()=>{
 assert.equal(excel("exceljs/package.json").version,"4.4.0");assert.equal(archiveRequire("archiver/package.json").version,"5.3.2");assert.equal(excel("unzipper/package.json").version,"0.12.5");
 for(const utility of utilities){assert.equal(utility("glob/package.json").version,"14.0.3");const matcher=createRequire(utility.resolve("glob"));assert.equal(matcher("minimatch/package.json").version,"11.0.3");assert.equal(typeof utility("glob").sync,"function");}
 assert.equal(readdirRequire("minimatch/package.json").version,"11.0.3");assert.equal(typeof readdirRequire("minimatch").Minimatch,"function");
});
test("security amplified globparts pattern completes in a bounded child using the actual patched matcher",async()=>{
 const matcher=readdirRequire.resolve("minimatch"),script=`const {Minimatch}=require(process.argv[1]);const pattern='a/'+('**/../'.repeat(32))+'*.xlsx';for(let i=0;i<10;i++){const m=new Minimatch(pattern,{optimizationLevel:2});m.match('a/report.xlsx');}process.stdout.write('MATCHER_BOUNDED_PASS');`;
 const result=await promisify(execFile)(process.execPath,["--max-old-space-size=128","-e",script,matcher],{timeout:10000,maxBuffer:4096});assert.equal(result.stdout,"MATCHER_BOUNDED_PASS");
});
