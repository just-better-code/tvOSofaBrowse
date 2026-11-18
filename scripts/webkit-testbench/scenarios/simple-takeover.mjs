// Observable simple-flow regression: actual HTML media + actual VLC, modeled UI.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,delay,waitFor} from './fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc (or --app)');
 const media=await fixture();
 const playing=()=>lab.native.phase==='playing';
 try{
  await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
  await leaf.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await leaf.evaluate(()=>{window.ends=[];const v=document.querySelector('video');v.addEventListener('ended',event=>{window.ends.push(event.isTrusted);if(window.ends.length===1){v.src='/two.webm';v.play()}});v.currentTime=2;v.play().catch(()=>{})});
  await waitFor(()=>lab.native.presented,{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert(await leaf.evaluate(()=>document.querySelector('video').paused));
  assert(lab.native.session.time>=2.09,'Capture requires at least 0.1 s actual HTML advance');
  await waitFor(playing,{describe:()=>JSON.stringify(lab.native.snapshot())});
  const first=lab.native.session.body.session;
  lab.native.decoder.command('seek',{time:5});
  await waitFor(async()=> (await lab.native.decoder.status()).timeMs>=4800);
  await lab.native.close('closed');await delay(300);
  const returned=await leaf.evaluate(()=>({paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime}));
  assert(returned.paused);assert(returned.time>=4.8);assert.equal(lab.native.phase,'idle');
  await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
  await waitFor(()=>playing()&&lab.native.session?.body.session!==first,{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert(lab.native.session.time>=returned.time+.09,'Manual Play must rearm the same source after actual advance');
  // Native Next seeks VLC near EOF; its actual EOF then returns the HTML media,
  // and only the HTML video's real ended listener
  // chooses the next item. The site's MediaSession next handler must not run.
  await lab.native.next();
  await waitFor(()=>playing()&&lab.native.session?.body.url.endsWith('/two.webm'),{describe:()=>JSON.stringify(lab.native.snapshot())});
  assert.equal(await leaf.evaluate(()=>nexts),0);
  assert.deepEqual(await leaf.evaluate(()=>ends),[true]);
  // Actual VLC EOF closes the modeled player and returns HTML near its real EOF.
  lab.native.decoder.command('seek',{time:11});
  await waitFor(()=>lab.native.phase==='idle',{timeout:10000,describe:()=>JSON.stringify(lab.native.snapshot())});
  await waitFor(()=>leaf.evaluate(()=>window.ends.length===2),{timeout:3000});
  assert.deepEqual(await leaf.evaluate(()=>ends),[true,true]);
  assert(await leaf.evaluate(()=>document.querySelector('video').ended));
  const events=(await readFile(path.join(lab.runDirectory,'events.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const presented=events.findIndex(e=>e.event==='native-host'&&e.name==='presented');
  const ready=events.findIndex(e=>e.event==='native-host'&&e.name==='decoder-ready');
  assert(presented>=0&&ready>presented,'Presentation must precede decoder readiness');
  assert(!events.some(e=>e.event==='bridge-trace'&&e.replyAction==='prepare'),'No hidden prepare round trip');
  console.log(JSON.stringify({runDirectory:lab.runDirectory,actualVLC:true,actualHTMLAdvanceThreshold:true,singleAcceptedAck:true,presentationBeforeDecoderReady:true,startAndReturnPosition:true,midClosePaused:true,sameSourceManualRearm:true,nextUsesTrustedEOF:true,naturalVLCEndReturnsTrustedEOF:true,UIKit:'modeled'}));
 }finally{await lab.native.dispose();await lab.page.goto('about:blank');await media.close()}
}
