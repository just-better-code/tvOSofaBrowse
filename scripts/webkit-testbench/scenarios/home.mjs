// Lifecycle scheduling is modeled; source pause/acks and VLC decoding are real.
import assert from'node:assert/strict';
import{fixture,delay,waitFor}from'./fixture.mjs';
export default async function(lab){
 if(!lab.native)throw Error('Use --bridge --native-vlc');
 const media=await fixture(),native=lab.native;
 const receive=native.receive.bind(native),checkpoint=native.checkpoint.bind(native);
 const results=[];
 try{
   for(const mode of ['healthy','stale-inactive-visible','modal-before-pause','lost-offer-reply','accepted-ack-home','lost-accepted-ack']){
    let offers=0,firstId,firstURL,interrupted=false;
    native.overview=mode==='modal-before-pause';
   native.receive=async(frame,handler,body)=>{
    if(handler==='browserFullscreenMedia'&&!frame.parentFrame()&&body?.vlcRequest){offers++;firstId??=body.session;firstURL??=body.url;
     if(mode==='lost-offer-reply'&&offers===1){lab.record('injected-lost-offer-reply',{session:body.session});return}}
    return receive(frame,handler,body);
   };
   native.checkpoint=async(session,expected)=>{
    const reply=await checkpoint(session,expected);
     if(!interrupted&&expected==='accepted'){
      if(mode==='accepted-ack-home'){
       interrupted=true;
       assert(await leaf.evaluate(()=>document.querySelector('video').paused));
       await native.setActive(false);
       await delay(150);
       assert(await leaf.evaluate(()=>document.querySelector('video').paused),'No rollback playback behind Home');
       await native.setActive(true);
      }else if(mode==='lost-accepted-ack'){
       interrupted=true;
       assert(await leaf.evaluate(()=>document.querySelector('video').paused));
       throw Error('injected-lost-accepted-ack');
      }
    }return reply;
   };
   await lab.page.goto(media.origin+'/top');const leaf=lab.page.frames().find(f=>f.url().endsWith('/leaf'));
   await leaf.waitForFunction(()=>document.querySelector('video').readyState>=2);
   if(mode==='healthy'){await native.setActive(false);await native.setActive(true);await delay(100)}
   if(mode==='stale-inactive-visible'){
    await leaf.evaluate(()=>{
     addEventListener('message',event=>{
      if(event.source===parent && event.data?.browserTVVLCConfiguration &&
       event.data.enabled===true && event.data.active===false)
       window.__labInactiveOnVisiblePage=document.visibilityState==='visible';
     });
    });
    await lab.page.evaluate(()=>window.__browserTVSetIframeVLCExperiment(true,false));
    await leaf.waitForFunction(()=>window.__labInactiveOnVisiblePage);
   }
   await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   if(mode==='stale-inactive-visible'){
    await leaf.waitForFunction(()=>{
     const video=document.querySelector('video');return !video.paused && video.currentTime>.35;
    },null,{timeout:4000});
    assert.equal(offers,0);
    await native.configure();
    }else if(mode==='modal-before-pause'||mode==='lost-offer-reply'){
     await waitFor(()=>offers===1);
     await leaf.waitForFunction(()=>{const v=document.querySelector('video');return !v.paused&&v.currentTime>.5});
     native.overview=false; // No new Play, reload, toggle or permission refresh.
   }
   await waitFor(()=>native.phase==='playing',{describe:()=>JSON.stringify(native.snapshot())});
    if(!['healthy','stale-inactive-visible'].includes(mode)){
     assert.equal(offers,2);assert.notEqual(native.session.body.session,firstId);assert.equal(native.session.body.url,firstURL);
    }
    assert((await native.decoder.status()).displayedPictures>0);
   const captured=native.session.body.session;
   await native.setActive(false);await delay(100);await native.setActive(true);await native.close('closed');await delay(100);
   assert(await leaf.evaluate(()=>document.querySelector('video').paused));
   await native.setActive(false);await native.setActive(true);await delay(100);
   await leaf.evaluate(()=>{document.querySelector('video').play().catch(()=>{})});
   await waitFor(()=>native.phase==='playing'&&native.session?.body.session!==captured,{describe:()=>JSON.stringify(native.snapshot())});
   results.push({mode,offers,recovered:true,actualVLC:true});await native.close('closed');
  }
   console.log(JSON.stringify({runDirectory:lab.runDirectory,results,sameSourceWithoutExtraPlay:true,UIKit:'modeled',TVcause:'not established'}));
 }finally{native.receive=receive;native.checkpoint=checkpoint;await native.dispose();await lab.page.goto('about:blank');await media.close()}
}
