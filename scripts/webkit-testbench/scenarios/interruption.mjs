import assert from 'node:assert/strict';
import {fixture,delay,waitFor} from './fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture();
 const options=lab.native.options;options.ackDelayMs=400;
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
  await waitFor(()=>lab.native.phase==='checking');
  await lab.native.setActive(false);await delay(150);
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  await lab.native.setActive(true);await delay(100);
  await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
  await waitFor(()=>lab.native.phase==='playing',{describe:()=>JSON.stringify(lab.native.snapshot())});
  await lab.native.close('closed');await delay(300);
  assert.equal(lab.native.phase,'idle');assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  const changed=lab.native.serial;
  await leaf.evaluate(()=>{const v=document.querySelector('video');v.src='/change-before-accept.webm';v.play().catch(()=>{})});
  await waitFor(()=>lab.native.phase==='checking');
  await leaf.evaluate(()=>{document.querySelector('video').src='/replaced.webm'});
  await waitFor(()=>lab.native.phase==='idle',{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert.equal(lab.native.serial,changed+1);assert.equal(lab.native.presented,false);
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualLinuxLibVLC:true,cancelledBeforeAcceptanceRetriesOnNewPlay:true,midBackLeavesPaused:true,changedSourceDoesNotAccept:true,injectedAckDelayMs:400,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
