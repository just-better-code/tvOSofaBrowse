import assert from'node:assert/strict';
import{fixture,waitFor,delay}from'./fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture();
 try{
  lab.native.enabled=false;await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await leaf.evaluate(()=>document.querySelector('video').requestFullscreen());await delay(100);
  assert.equal(lab.native.presented,false);
  lab.native.enabled=true;await lab.native.configure();await delay(100);
  await leaf.evaluate(()=>{const v=document.querySelector('video');v.load();v.play().catch(()=>{})});
  await waitFor(()=>lab.native.presented,{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert(lab.native.session.time>=.09,'Existing fullscreen/metadata must not bypass the actual-play threshold');
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  console.log(JSON.stringify({runDirectory:lab.runDirectory,productionBridge:true,existingFullscreen:true,metadataDoesNotBypassPlayThreshold:true,acceptedTime:lab.native.session.time,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
