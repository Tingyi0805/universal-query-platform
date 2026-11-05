// Localhost-only server for the synthetic Chart Lab artifact.
// Node 24 built-ins only; no network binding beyond loopback, no APIs.
import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL(".",import.meta.url)),"chart-lab-dist");
const port=4174;
const types={
 ".html":"text/html; charset=utf-8",
 ".js":"text/javascript; charset=utf-8",
 ".css":"text/css; charset=utf-8",
 ".svg":"image/svg+xml",
 ".png":"image/png",
 ".ico":"image/x-icon",
 ".woff2":"font/woff2",
};
const serve=async(req,res)=>{
 try {
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
  const url=new URL(req.url??"/","http://127.0.0.1");
  if(url.pathname.startsWith("/api/")){res.writeHead(404);res.end();return;}
  const pathname=url.pathname==="/"?"/chart-lab.html":url.pathname;
  if(!(/^\/chart-lab\.html$/.test(pathname)||
       /^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname))){
   res.writeHead(404);res.end();return;
  }
  const target=resolve(root,"."+pathname);
  if(!target.startsWith(root+sep)){res.writeHead(404);res.end();return;}
  const type=types[target.slice(target.lastIndexOf("."))]??"application/octet-stream";
  const info=await stat(target);
  if(!info.isFile()||info.size>15*1024*1024){res.writeHead(404);res.end();return;}
  const data=await readFile(target);
  res.writeHead(200,{"Content-Type":type,"X-Content-Type-Options":"nosniff",
   "Cache-Control":"no-store","Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
   "Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"});
  res.end(req.method==="HEAD"?undefined:data);
 }catch{res.writeHead(404);res.end();}
};
const server=createServer((req,res)=>{void serve(req,res);});
server.listen(port,"127.0.0.1",()=>{
 console.log("UQP 合成圖表測試頁：http://127.0.0.1:"+port+"/chart-lab.html");
 console.log("完全離線、無後端 API。按 Ctrl+C 關閉。");
});
