// Expire only the local fixture input after actual accepted acknowledgement.
import assert from'node:assert/strict';
import{fixture,delay,waitFor}from'./fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture(),native=lab.native;const checkpoint=native.checkpoint.bind(native);let injected=false;
 native.checkpoint=async(session,expected)=>{const reply=await checkpoint(session,expected);if(!injected&&expected==='accepted'){injected=true;media.setMediaDenied(true);lab.record('injected-http403-after-accepted',{})}return reply};
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await leaf.evaluate(()=>{window.ends=0;document.querySelector('video').addEventListener('ended',()=>ends++);document.querySelector('video').play().catch(()=>{})});
  await waitFor(()=>native.phase==='error',{timeout:5000,describe:()=>JSON.stringify(native.snapshot())});
  assert(native.presented);assert.equal(await leaf.evaluate(()=>ends),0);
  const frozen=await leaf.evaluate(()=>({time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused,duration:document.querySelector('video').duration}));assert(frozen.paused);assert(frozen.time<2);
  await native.close('closed');await delay(100);
  const returned=await leaf.evaluate(()=>({time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused}));assert(returned.paused);assert(Math.abs(returned.time-frozen.time)<1);
  media.setMediaDenied(false);await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});await waitFor(()=>native.phase==='playing');
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualHTTP403:true,actualLinuxLibVLC:true,failedStartStaysPresented:true,noFalseHTMLCompletion:true,frozen,returned,manualReplayRecaptures:true,injectedExpiryAfterAck:true,UIKit:'modeled',TVcause:'not established'}));
 }finally{native.checkpoint=checkpoint;await native.dispose();await lab.page.goto('about:blank');await media.close()}
}
