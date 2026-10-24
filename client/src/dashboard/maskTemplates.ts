export type MaskTemplate={id:string;revision:string;version:string;name:string;aliases:string[];mode:"NONE"|"CUSTOM"|"FULL"|"OMIT";customMask:{prefix:number;suffix:number;symbol:string;start?:number;end?:number}|null;suggestedPublicAllowed:boolean;isActive:boolean;createdBy?:string;updatedBy?:string;updatedAtUtc?:string;uses?:{DatasetId:string;ColumnName:string;State:string;Code:string|null}[]};
const key=(v:string)=>v.normalize("NFKC").toUpperCase();
export function templateSuggestion(name:string,templates:MaskTemplate[]):{template:MaskTemplate;kind:"EXACT"|"ALIAS"}|null{
 const active=templates.filter(t=>t.isActive);for(const kind of ["EXACT","ALIAS"] as const){const matches=active.filter(t=>kind==="EXACT"?key(t.name)===key(name):t.aliases.some(a=>key(a)===key(name)));if(matches.length)return matches.length===1?{template:matches[0]!,kind}:null;}return null;
}
export function templatePreview(mode:MaskTemplate["mode"],c:MaskTemplate["customMask"]){
 const chars=Array.from("合成資料123456");if(mode==="OMIT")return "不傳送";if(mode==="FULL")return "○○○○";if(mode==="NONE")return chars.join("");if(!c||Array.from(c.symbol).length!==1)return "設定無效";
 if(c.start!==undefined)return c.start>chars.length?c.symbol.repeat(chars.length):chars.map((v,i)=>i+1>=c.start!&&i+1<=c.end!?c.symbol:v).join("");
 return c.prefix+c.suffix>=chars.length?c.symbol.repeat(chars.length):chars.slice(0,c.prefix).join("")+c.symbol.repeat(chars.length-c.prefix-c.suffix)+(c.suffix?chars.slice(-c.suffix).join(""):"");
}
