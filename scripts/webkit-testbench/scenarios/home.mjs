// Lifecycle scheduling is modeled; source pause/acks and VLC decoding are real.
import assert from'node:assert/strict';
import{fixture,delay,waitFor}from'./fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture(),native=lab.native;
 const receive=native.receive.bind(native),checkpoint=native.checkpoint.bind(native);
 const results=[];
 try{
  for(const mode of ['healthy','accepted-ack-home','lost-offer-reply']){
   let offers=0,firstId,firstURL,interrupted=false,interruptionDone=false;
   native.receive=async(frame,handler,body)=>{
    if(handler==='browserFullscreenMedia'&&!frame.parentFrame()&&body?.vlcRequest){offers++;firstId??=body.session;firstURL??=body.url;
     if(mode==='lost-offer-reply'&&offers===1){lab.record('injected-lost-offer-reply',{session:body.session});return}}
    return receive(frame,handler,body);
   };
   native.checkpoint=async(session,expected)=>{
    const reply=await checkpoint(session,expected);
    if(mode==='accepted-ack-home'&&!interrupted&&expected==='accepted'){
     interrupted=true;await native.setActive(false);await delay(100);await native.setActive(true);interruptionDone=true;
    }return reply;
   };
   await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
   await leaf.waitForFunction(()=>document.querySelector('video').readyState>=2);
   if(mode==='healthy'){await native.setActive(false);await native.setActive(true);await delay(100)}
   await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   if(mode==='lost-offer-reply'){
    await waitFor(()=>offers===1);await native.setActive(false);await delay(100);await native.setActive(true);await delay(100);
    await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   }else if(mode==='accepted-ack-home'){
    await waitFor(()=>interruptionDone&&native.active&&native.phase==='idle');await delay(100);
    await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   }
   await waitFor(()=>native.phase==='playing',{describe:()=>JSON.stringify(native.snapshot())});
   if(mode!=='healthy'){assert(offers>=2);assert.notEqual(native.session.body.session,firstId);assert.equal(native.session.body.url,firstURL)}
   const captured=native.session.body.session;
   await native.setActive(false);await delay(100);await native.setActive(true);await native.close('closed');await delay(100);
   assert(await leaf.evaluate(()=>document.querySelector('video').paused));
   await native.setActive(false);await native.setActive(true);await delay(100);
   await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   await waitFor(()=>native.phase==='playing'&&native.session?.body.session!==captured,{describe:()=>JSON.stringify(native.snapshot())});
   results.push({mode,offers,recovered:true,actualVLC:true});await native.close('closed');
  }
  console.log(JSON.stringify({runDirectory:lab.runDirectory,results,injectedLostReplyCount:1,injectedAckInterruption:true,UIKit:'modeled',TVcause:'not established'}));
 }finally{native.receive=receive;native.checkpoint=checkpoint;await native.dispose();await lab.page.goto('about:blank');await media.close()}
}
