import assert from 'node:assert/strict';
import {fixture,delay,waitFor} from './fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture();
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.evaluate(()=>{const v=document.querySelector('video');v.src='/stall.webm';return v.play()});
  await waitFor(()=>lab.native.presented);const started=Date.now();
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  await waitFor(()=>lab.native.phase==='error',{timeout:22000,describe:()=>JSON.stringify(lab.native.snapshot())});
  const elapsed=Date.now()-started;assert(elapsed>=14500);
  assert.equal(lab.native.presented,true);
  await lab.native.close('closed');
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  const serial=lab.native.serial;await delay(300);assert.equal(lab.native.serial,serial);
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualLinuxLibVLC:true,actualHTTPDecoderStall:true,visiblePlaybackTimeoutMs:elapsed,immediatePresentation:true,HTMLPausedUntilClose:true,midCloseRemainsPaused:true,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
