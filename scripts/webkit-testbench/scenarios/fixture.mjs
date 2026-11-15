import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {dataRoot} from '../runtime.mjs';
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function waitFor(predicate,{timeout=20000,describe=()=>''}={}){
 const deadline=Date.now()+timeout;
 while(!await predicate()){if(Date.now()>deadline)throw Error('Wait timed out: '+describe());await delay(50)}
}
export async function fixture(){
 let bytes;try{bytes=await readFile(path.join(dataRoot,'fixture.webm'))}catch{throw Error('Generate the ignored fixture first: scripts/webkit-testbench/generate-fixture.sh')}
 let origin;const requests=new Map();
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,origin);
  if(url.pathname.endsWith('.webm')){
   const count=(requests.get(url.pathname)||0)+1;requests.set(url.pathname,count);
   if(url.pathname==='/stall.webm'&&count>1){setTimeout(()=>response.destroy(),25000).unref();return}

   const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'');
   const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
   if(start>=bytes.length||start>end){response.writeHead(416,{'content-range':`bytes */${bytes.length}`});response.end();return}
   response.writeHead(match?206:200,{'content-type':'video/webm','accept-ranges':'bytes','content-length':end-start+1,...(match?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})});response.end(request.method==='HEAD'?undefined:bytes.subarray(start,end+1));return;
  }
  const body=url.pathname==='/top'?`<iframe width="650" height="350" src="http://localhost:${server.address().port}/leaf"></iframe>`:`<video controls muted width="560" height="280" src="/one.webm"></video><script>window.nexts=0;navigator.mediaSession.setActionHandler('nexttrack',()=>{nexts++;const v=document.querySelector('video');v.src='/'+(nexts+1)+'.webm';v.play()});</script>`;
  response.writeHead(200,{'content-type':'text/html'});response.end(body);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 return{origin,close:()=>new Promise(r=>{server.close(r);server.closeAllConnections()})};
}
