import assert from 'node:assert/strict';
import {fixture,delay,waitFor} from './fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture();
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.evaluate(()=>{const v=document.querySelector('video');v.src='/stall.webm';return v.play()});
  await waitFor(()=>lab.native.phase==='preparing');const started=Date.now();
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  await waitFor(()=>lab.native.phase==='idle',{timeout:22000,describe:()=>JSON.stringify(lab.native.snapshot())});
  const elapsed=Date.now()-started;assert(elapsed>=14500);
  await waitFor(()=>leaf.evaluate(()=>!document.querySelector('video').paused),{timeout:3000});
  const serial=lab.native.serial;await delay(300);assert.equal(lab.native.serial,serial);
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualLinuxLibVLC:true,actualHTTPDecoderStall:true,preparationTimeoutMs:elapsed,HTMLPausedUntilFailure:true,rollbackResumesOnce:true,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
