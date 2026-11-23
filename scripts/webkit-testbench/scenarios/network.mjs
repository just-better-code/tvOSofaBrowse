// Standard tc/netem shapes actual traffic; no routing/body-delay approximation.
import http from 'node:http';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import simpleTakeover from './simple-takeover.mjs';
export default async function(lab){
 const network=JSON.parse(process.env.WEBKIT_LAB_NETWORK||'null');
 assert.equal(network?.mechanism,'Linux tc/netem + rootless slirp4netns','Run through slow-network.py');
 const body=Buffer.alloc(128*1024,42);
 const server=http.createServer((request,response)=>{
  response.writeHead(200,{'content-type':'application/octet-stream','content-length':body.length,'access-control-allow-origin':'*','connection':'close'});response.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const started=performance.now();
  const bytes=await lab.page.evaluate(async url=>(await(await fetch(url)).arrayBuffer()).byteLength,'http://127.0.0.1:'+server.address().port+'/bytes');
  const elapsedMs=Math.round(performance.now()-started),expectedMs=body.length*8/network.downloadKbps;
  assert.equal(bytes,body.length);
  assert(elapsedMs>=expectedMs*.7&&elapsedMs<expectedMs*3+2000,'Actual byte transfer must match the imposed rate');
  console.log(JSON.stringify({runDirectory:lab.runDirectory,network,payloadBytes:bytes,elapsedMs,minimumTransferMs:Math.round(expectedMs)}));
  await simpleTakeover(lab);
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
}
