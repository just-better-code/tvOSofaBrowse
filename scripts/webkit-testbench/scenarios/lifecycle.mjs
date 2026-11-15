import assert from 'node:assert/strict';
import {fixture,delay,waitFor} from './fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture();
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.evaluate(()=>document.querySelector('video').play());
  const playing=()=>lab.native.phase==='playing';
  await waitFor(playing,{describe:()=>JSON.stringify(lab.native.snapshot())});
  const first=lab.native.session.body.session;
  assert.equal((await lab.remote.playPause()).state,4);assert.equal((await lab.remote.playPause()).state,3);
  await assert.rejects(async()=>lab.remote.center(100,100),/UIKit focus/);
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  await lab.native.setActive(false);await lab.native.setActive(true);
  await lab.native.close('next',{callbackPhase:'completion',dismissalDelayMs:500});
  await waitFor(()=>playing()&&lab.native.session?.body.session!==first,{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert.equal(await leaf.evaluate(()=>nexts),1);
  await lab.native.close('next',{callbackPhase:'viewDidDisappear',dismissalDelayMs:700});
  await delay(1000);assert.equal(await leaf.evaluate(()=>nexts),2);
  assert.equal(lab.native.phase,'idle');assert(!await leaf.evaluate(()=>document.querySelector('video').paused));
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualLinuxLibVLC:true,nativePlayPauseUsesDecoder:true,nativeCenterDoesNotClickHiddenPage:true,crossOriginPrepareAck:true,nextAfterCompletionRecaptures:true,acceptedSessionSurvivesInactive:true,earlyCallbackReproducesLostCapture:true,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
