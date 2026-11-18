/** CI loopback TDS transport fault, not a fake Transaction.commit implementation.
 * Login traffic may use TLS. Only the explicitly unencrypted CI connection's
 * TM_COMMIT packet is recognized; payloads are never logged or persisted. */
import net from 'node:net';
export async function create929CommitProxy(targetPort:number){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.UQP929_APPROVE!=='DISPOSABLE_GITHUB_HOSTED_929_ONLY'||targetPort!==14339)throw Error('929_PROXY_CI_ONLY');
 const sockets=new Set<net.Socket>();let armed=false,commitObserved=false,held=false;
 const server=net.createServer(client=>{
  const upstream=net.connect({host:'127.0.0.1',port:targetPort});sockets.add(client);sockets.add(upstream);let packets=Buffer.alloc(0),drop=false;
  const close=()=>{client.destroy();upstream.destroy();sockets.delete(client);sockets.delete(upstream);};
  client.on('error',close);upstream.on('error',close);client.on('close',close);upstream.on('close',close);
  client.on('data',b=>{
   if(armed&&!commitObserved){packets=Buffer.concat([packets,b]);if(packets.length>1048576){close();return;}
    while(packets.length>=8){const length=packets.readUInt16BE(2);if(length<8){close();return;}if(packets.length<length)break;
     const p=packets.subarray(0,length);packets=packets.subarray(length);
     if(p[0]===0x0e&&p.length>=14){const allHeaders=p.readUInt32LE(8),typeAt=8+allHeaders;if(typeAt+2<=p.length&&p.readUInt16LE(typeAt)===7){commitObserved=true;drop=true;}}
    }
   }
   upstream.write(b);
  });
  upstream.on('data',b=>{if(drop){held=true;return;}client.write(b);});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();if(!address||typeof address==='string')throw Error('929_PROXY_ADDRESS');
 return {port:address.port,arm:()=>{armed=true;},state:()=>({commitObserved,held}),disconnect:()=>{for(const s of sockets)s.destroy();},
  close:async()=>{for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
