import { readFile } from "node:fs/promises";
import type sql from "mssql";

export const displayTables = ["DatasetPublicDisplayPolicy", "DatasetMaskTemplate", "DatasetMaskTemplateUse"];
export const displayDdlUrl = new URL("../../../../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql", import.meta.url);
export class DatasetDisplayError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export const exactPositiveId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
export function exactRevision(v: unknown): string {
  if (!Buffer.isBuffer(v) || v.length !== 8) throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503);
  return v.toString("hex");
}
export const displayCatalogSql = `
SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID(N'uqp') AND name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse');
SELECT t.name AS [table],c.name,ty.name AS type,c.max_length AS length,c.scale,c.is_nullable AS nullable,c.is_identity AS identityColumn,c.collation_name AS collation
 FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON c.user_type_id=ty.user_type_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse');
SELECT t.name AS [table],c.name,c.definition,c.is_disabled AS disabled,c.is_not_trusted AS untrusted,'CHECK' AS kind FROM sys.check_constraints c JOIN sys.tables t ON t.object_id=c.parent_object_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse')
 UNION ALL SELECT t.name,c.name,c.definition,0,0,'DEFAULT' FROM sys.default_constraints c JOIN sys.tables t ON t.object_id=c.parent_object_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse');
SELECT t.name AS [table],i.name,c.name AS [column],ic.key_ordinal AS ordinal,ic.is_included_column AS included,i.is_unique AS uniqueIndex,i.is_disabled AS disabled,i.has_filter AS filtered
 FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse') AND i.index_id>0;
SELECT t.name AS [table],f.name,c.name AS [column],rt.name AS target,rc.name AS targetColumn,f.delete_referential_action_desc AS deleteAction,f.update_referential_action_desc AS updateAction,f.is_disabled AS disabled,f.is_not_trusted AS untrusted,SCHEMA_NAME(rt.schema_id) AS targetSchema
 FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id=f.parent_object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=fc.parent_column_id JOIN sys.tables rt ON rt.object_id=f.referenced_object_id JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fc.referenced_column_id
 WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse');
SELECT tr.name FROM sys.triggers tr JOIN sys.tables t ON t.object_id=tr.parent_id WHERE t.schema_id=SCHEMA_ID(N'uqp') AND t.name IN ('DatasetPublicDisplayPolicy','DatasetMaskTemplate','DatasetMaskTemplateUse');
SELECT CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION')=1 OR
 (HAS_PERMS_BY_NAME('uqp.DatasetPublicDisplayPolicy','OBJECT','VIEW DEFINITION')=1 AND HAS_PERMS_BY_NAME('uqp.DatasetMaskTemplate','OBJECT','VIEW DEFINITION')=1 AND HAS_PERMS_BY_NAME('uqp.DatasetMaskTemplateUse','OBJECT','VIEW DEFINITION')=1) THEN 1 ELSE 0 END AS visible;`;
/** Restricted SQL CHECK/default grammar. Preserve grouping and three-valued logic;
 * normalize SQL Server's IN -> OR serialization, never discard parentheses. */
export function canonicalDisplayExpression(text:string):string{
 const tokens=text.match(/N?'(?:''|[^'])*'|\[[A-Za-z_][A-Za-z0-9_]*\]|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|<>|<=|>=|[(),=<>]/g)??[];
 if(tokens.join("").replace(/\s/g,"")!==text.replace(/\s/g,""))throw new Error("CATALOG_EXPRESSION_UNKNOWN");
 let i=0;type Node={kind:string;args:Node[];value?:string};
 const atom=(value:string):Node=>({kind:"ATOM",args:[],value});
 const key=(n:Node):string=>n.kind==="ATOM"?JSON.stringify(n.value):`${n.kind}(${n.args.map(key).join(",")})`;
 const combine=(kind:string,args:Node[]):Node=>{const flat=args.flatMap(n=>n.kind===kind&&["AND","OR"].includes(kind)?n.args:[n]);if(["AND","OR","=" ,"<>"].includes(kind))flat.sort((a,b)=>key(a).localeCompare(key(b)));return {kind,args:flat};};
 const peek=()=>tokens[i]?.toUpperCase();const expect=(t:string)=>{if(peek()!==t)throw new Error("CATALOG_EXPRESSION_UNKNOWN");i++;};
 const operand=():Node=>{const t=tokens[i++];if(!t)throw new Error("CATALOG_EXPRESSION_UNKNOWN");if(t==="("){const n=or();expect(")");return n;}if(t==="N'"||t==="'"||["AND","OR","IS","IN",",", ")"].includes(t.toUpperCase()))throw new Error("CATALOG_EXPRESSION_UNKNOWN");if(t.startsWith("'")||t.startsWith("N'"))return atom(t.replace(/^N/,""));const name=t.replace(/[\[\]]/g,"").toUpperCase();if(peek()==="("){i++;const args:Node[]=[];if(peek()!==")"){args.push(or());while(peek()===","){i++;args.push(or());}}expect(")");return {kind:"CALL:"+name,args};}return atom(name);};
 const predicate=():Node=>{const lhs=operand(),next=peek();if(["=","<>","<",">","<=",">="].includes(next??"")){i++;return combine(next!,[lhs,operand()]);}if(next==="IS"){i++;const not=peek()==="NOT";if(not)i++;expect("NULL");return {kind:not?"IS_NOT_NULL":"IS_NULL",args:[lhs]};}if(next==="IN"){i++;expect("(");const list=[operand()];while(peek()===","){i++;list.push(operand());}expect(")");return combine("OR",list.map(n=>combine("=",[lhs,n])));}return lhs;};
 const and=():Node=>{let n=predicate();while(peek()==="AND"){i++;n=combine("AND",[n,predicate()]);}return n;};
 const or=():Node=>{let n=and();while(peek()==="OR"){i++;n=combine("OR",[n,and()]);}return n;};
 const result=or();if(i!==tokens.length)throw new Error("CATALOG_EXPRESSION_UNKNOWN");return key(result);
}
const norm=canonicalDisplayExpression;
/** Compare against reviewed source, not names alone. SQL Server adds parentheses to CHECK/DEFAULT text. */
export function validateDisplayCatalog(sets: Record<string, any>[][], ddl: string, diagnostic?:(reason:string)=>void): "ABSENT" | "EXACT_MATCH" {
  const fail = (reason="CATALOG_MISMATCH") => { diagnostic?.(reason); throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503); };
  if (!Array.isArray(sets) || sets.length !== 7 || sets[6]?.[0]?.visible !== 1) return fail();
  if (!sets[0]!.length && sets.slice(1,6).every(s=>!s.length)) return "ABSENT";
  if (sets[0]!.length !== 3 || sets[5]!.length) return fail();
  let count=0, constraintCount=0, fkCount=0, indexCount=0;
  const indexes: {table:string;name:string;keys:string[];include:string[];unique:boolean}[]=[];
  for (const table of displayTables) {
    const body = ddl.split(`CREATE TABLE uqp.${table} (`)[1]?.split("\n);")[0]; if (!body) return fail();
    for (const line of body.split("\n")) {
      const col=/^\s*(\w+)\s+(BIGINT|BINARY|NVARCHAR|VARCHAR|CHAR|DATETIME2|UNIQUEIDENTIFIER|ROWVERSION|BIT)(?:\((MAX|\d+)\))?(?:\s+COLLATE\s+(\w+))?(\s+IDENTITY\(1,1\))?\s+(NOT NULL|NULL)/i.exec(line);
      if (col) {
        count++;
        const c=sets[1]!.filter(c=>c.table===table&&c.name===col[1]);
        const type=col[2]!.toLowerCase(),length=col[3]==="MAX"?-1:col[3]?Number(col[3])*(type==="nvarchar"?2:1):({bigint:8,bit:1,uniqueidentifier:16,rowversion:8,datetime2:7} as Record<string,number>)[type];
        if(c.length!==1 || ![type,...(type==="rowversion"?["timestamp"]:[])].includes(c[0]!.type) || type!=="datetime2"&&c[0]!.length!==length || type==="datetime2"&&c[0]!.scale!==Number(col[3]) || !!c[0]!.nullable!==(col[6]==="NULL") || !!c[0]!.identityColumn!==!!col[5] || col[4]&&c[0]!.collation!==col[4])return fail("COLUMN_"+table+"_"+col[1]);
        const inline=/CONSTRAINT (\w+) PRIMARY KEY/.exec(line); if(inline)indexes.push({table,name:inline[1]!,keys:[col[1]!],include:[],unique:true});
      }
      const ck=/CONSTRAINT (\w+) CHECK\((.*)\),?$/.exec(line);
      const def=/CONSTRAINT (\w+) DEFAULT (.*),?$/.exec(line) ?? /CONSTRAINT (\w+) DEFAULT(\(.*\)),?$/.exec(line);
      if(ck||def){const m=(ck??def)!;constraintCount++;const found=sets[2]!.filter(c=>c.table===table&&c.name===m[1]);if(found.length!==1||found[0]!.disabled||found[0]!.untrusted||norm(found[0]!.definition)!==norm(m[2]!.replace(/,$/,"")))return fail("CONSTRAINT_"+m[1]);}
      const uq=/CONSTRAINT (\w+) UNIQUE\(([^)]+)\)/.exec(line);if(uq)indexes.push({table,name:uq[1]!,keys:uq[2]!.split(","),include:[],unique:true});
      const fk=/CONSTRAINT (\w+) FOREIGN KEY\((\w+)\) REFERENCES uqp\.(\w+)\((\w+)\)( ON DELETE CASCADE)?/.exec(line);
      if(fk){fkCount++;const f=sets[4]!.filter(f=>f.table===table&&f.name===fk[1]);if(f.length!==1||f[0]!.column!==fk[2]||f[0]!.target!==fk[3]||f[0]!.targetColumn!==fk[4]||f[0]!.deleteAction!==(fk[5]?"CASCADE":"NO_ACTION")||f[0]!.updateAction!=="NO_ACTION"||f[0]!.targetSchema!=="uqp"||f[0]!.disabled||f[0]!.untrusted)return fail();}
    }
  }
  for(const m of ddl.matchAll(/CREATE INDEX (\w+) ON uqp\.(\w+)\(([^)]+)\)(?: INCLUDE\(([^)]+)\))?/g))indexes.push({name:m[1]!,table:m[2]!,keys:m[3]!.split(","),include:m[4]?.split(",")??[],unique:false});
  for(const i of indexes){const found=sets[3]!.filter(r=>r.table===i.table&&r.name===i.name);indexCount+=found.length;const keys=found.filter(r=>r.ordinal>0).sort((a,b)=>a.ordinal-b.ordinal).map(r=>r.column),includes=found.filter(r=>r.included).map(r=>r.column).sort();if(JSON.stringify(keys)!==JSON.stringify(i.keys)||JSON.stringify(includes)!==JSON.stringify([...i.include].sort())||found.some(r=>r.disabled||r.filtered||!!r.uniqueIndex!==i.unique))return fail("INDEX_"+i.name);}
  if(count!==sets[1]!.length||constraintCount!==sets[2]!.length||fkCount!==sets[4]!.length||indexCount!==sets[3]!.length)return fail("CATALOG_COUNTS");
  return "EXACT_MATCH";
}
export async function requireDisplaySchema(request: sql.Request): Promise<void> {
  const [result,ddl]=await Promise.all([request.query(displayCatalogSql),readFile(displayDdlUrl,"utf8")]);
  if(validateDisplayCatalog(result.recordsets as unknown as Record<string,any>[][],ddl)!=="EXACT_MATCH")throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503);
}
