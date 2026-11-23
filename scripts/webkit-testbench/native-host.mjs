// A host-contract model around actual page JS and Linux libVLC. UIKit is modeled.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DesktopVLC} from './desktop-vlc.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const hostInitScript=`(() => {
 const token=crypto.randomUUID();
 Object.defineProperty(window,'__webkitLabDocumentToken',{value:token,configurable:true,writable:true});
 window.__webkitLabBridgeTrace=[];
 const trace=(action,data)=>{const event={action,...data};window.__webkitLabBridgeTrace.push(event);if(window.__webkitLabBridgeTrace.length>256)window.__webkitLabBridgeTrace.shift();window.__webkitLabTrace?.(token,event).catch(()=>{});};
 for(const name of ['__browserTVVLCResponse','__browserTVVLCRequestIsCurrent','__browserTVVLCHandoffResult']){
  const original=window[name];if(typeof original!=='function')continue;
  window[name]=function(...args){try{const result=Reflect.apply(original,this,args);trace(name,{session:args[0],replyAction:name==='__browserTVVLCResponse'?args[1]:undefined,result});return result}catch(error){trace(name,{session:args[0],error:error.name});throw error}};
 }
 addEventListener('pagehide',()=>trace('pagehide',{}));
})();`;
function referrer(documentURL,mediaURL,policy='strict-origin-when-cross-origin'){
 const document=new URL(documentURL),media=new URL(mediaURL);
 document.username=document.password=document.hash='';
 const same=document.origin===media.origin,downgrade=document.protocol==='https:'&&media.protocol==='http:';
 if(policy==='no-referrer'||policy==='same-origin'&&!same)return '';
 if(policy==='origin'||policy==='strict-origin'&&!downgrade)return document.origin+'/';
 if(policy==='unsafe-url'||policy==='same-origin'&&same)return document.href;
 if(policy==='no-referrer-when-downgrade')return downgrade?'':document.href;
 if(policy==='origin-when-cross-origin')return same?document.href:document.origin+'/';
 return downgrade?'':same?document.href:document.origin+'/';
}
class Decoder {
 constructor(configuration,record){
  this.last={timeMs:0};this.waiters=[];this.record=record;
  this.process=spawn('python3',[fileURLToPath(new URL('./vlc-worker.py',import.meta.url))],{stdio:['pipe','pipe','ignore']});
  this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject});
  createInterface({input:this.process.stdout}).on('line',line=>{
   let data;try{data=JSON.parse(line)}catch{return}
   this.last={...this.last,...data};record('linux-vlc',data);
   if(data.event==='ready')this.resolve(data);
   if(data.event==='failure')this.reject(Error(data.reason));
   if(data.event==='ended')this.onEnded?.(data);
   if(data.event==='status')for(const resolve of this.waiters.splice(0))resolve(data);
  });
  this.process.on('error',error=>this.reject(error));
  this.process.on('exit',(code)=>{this.reject(Error(`decoder-exit-${code}`));for(const resolve of this.waiters.splice(0))resolve(this.last)});
  this.process.stdin.on('error',()=>{});
  this.process.stdin.write(JSON.stringify(configuration)+'\n');
 }
 command(action,values={}){if(!this.process.killed&&!this.process.stdin.destroyed)this.process.stdin.write(JSON.stringify({action,...values})+'\n')}
 async status(){return Promise.race([new Promise(resolve=>{this.waiters.push(resolve);this.command('status')}),delay(1000).then(()=>this.last)])}
 async stop(){if(this.process.exitCode!==null)return;this.command('stop');this.process.stdin.end();await Promise.race([new Promise(resolve=>this.process.once('exit',resolve)),delay(2000)]);if(this.process.exitCode===null)this.process.kill('SIGTERM')}
}
export class NativeMediaHost {
 constructor(context,{record,runDirectory,options={}}){
  this.context=context;this.record=record;this.runDirectory=runDirectory;this.options=options;
  this.enabled=options.experiment!==false;this.active=true;this.page=null;this.presented=false;this.overview=false;this.serial=0;this.phase='idle';this.session=null;this.decoder=null;
 }
 snapshot(){return{phase:this.phase,presented:this.presented,active:this.active,experiment:this.enabled,session:this.session?.body.session,serial:this.serial,decoder:this.options.transport==='desktop'?'desktop VLC CLI':'Linux libVLC',UIKit:'modeled'}}
 event(name,extra={}){this.record('native-host',{name,...this.snapshot(),...extra})}
 async bind(){
  await this.context.exposeBinding('__webkitLabTrace',({frame},documentToken,event)=>this.record('bridge-trace',{frameHost:new URL(frame.url()).hostname,documentToken,...event}));
 }
 async configure(page=this.page){if(!page||page.isClosed())return;await page.evaluate(({enabled,active,suspended})=>{window.__browserTVSetFullscreenMediaSuspended?.(suspended);window.__browserTVSetIframeVLCExperiment?.(enabled,active)},{enabled:this.enabled,active:this.active&&page===this.page&&!this.presented,suspended:this.presented||!this.active||page!==this.page})}
  async setPage(page){const previous=this.page;this.serial++;this.page=page;if(previous&&previous!==page)await this.configure(previous);await this.cancel(false);await this.configure();this.event('active-page')}
  async setActive(active){this.active=!!active;if(!active&&(!this.presented||this.options.invalidateAcceptedOnResign))this.serial++;await this.configure();if(!active)await this.cancel(false);this.event('application-active')}
 async evaluate(session,expression,args=[]){
  if(session.frame.isDetached()||session.frame.page().isClosed())throw Error('detached-document');
  return session.frame.evaluate(({expression,args,token})=>{if(window.__webkitLabDocumentToken!==token)throw Error('changed-document');return (0,eval)(expression)(...args)},{expression,args,token:session.documentToken});
 }
 async isActive(session){return !this.disposed&&this.active&&session.frame.page()===this.page&&session.serial===this.serial&&!this.presented&&!this.overview&&this.enabled}
  async response(session,action,time=0,volume=0,muted=false,exitFullscreen=false){
  if(!this.active||session.frame.page()!==this.page||session.serial!==this.serial){
   if(action==='accepted')return false;
   if(['closed','ended','next','previous','trackDone','trackEnd'].includes(action))action='released';
  }
  this.event('response',{action});
   return this.evaluate(session,'window.__browserTVVLCResponse',[session.body.session,action,time,volume,muted,exitFullscreen]);
 }
 async checkpoint(session,expected){
  const deadline=Date.now()+2000;let reply;
  do{reply=JSON.parse(await this.evaluate(session,'window.__browserTVVLCHandoffResult',[session.body.session]));if(!reply?.pending)break;await delay(50)}while(Date.now()<deadline);
   this.event('ack',{expected,reply});
   if(!reply?.[expected])throw Error(`missing-${expected}-ack`);
  return reply;
 }
 async receive(frame,handler,body){
  if(handler!=='browserFullscreenMedia'||frame.parentFrame())return;
  if(body?.vlcConfigRequest){await this.configure(frame.page());return}
  if(!body?.vlcRequest)return;
  const session={body,frame,documentToken:await frame.evaluate(()=>window.__webkitLabDocumentToken),serial:0};
  if(frame.page()!==this.page||this.presented||!this.active||this.overview||this.session){await this.response(session,'cancelled');this.event('offer-rejected-unavailable');return}
  session.serial=++this.serial;
  this.session=session;this.phase='checking';this.event('offer');
  try{
   if(!await this.evaluate(session,'window.__browserTVVLCRequestIsCurrent',[body.session]))throw Error('stale-offer');
   if(!await this.isActive(session))throw Error('inactive-before-context');
   const userAgent=this.options.userAgent||await frame.evaluate(()=>navigator.userAgent);
   const media=new URL(body.url),document=new URL(body.documentURL);
   const cookies=body.crossOrigin==='anonymous'&&media.origin!==document.origin?[]:await this.context.cookies(body.url);
   await delay(this.options.ackDelayMs??0);
   if(!await this.isActive(session))throw Error('inactive-before-accept');
   this.phase='accepting';
   if(!await this.response(session,'accepted'))throw Error('accept-submission-rejected');
   const accepted=await this.checkpoint(session,'accepted');session.time=accepted.time;
   if(!await this.isActive(session)||this.session!==session)throw Error('inactive-after-accept');
   // The website is now paused. Presentation and playback start immediately;
   // decoded output is telemetry, never a second preparation/acceptance gate.
   this.presented=true;this.phase='presenting';await this.configure();this.event('presented',{time:session.time});
   const configuration={url:body.url,referrer:referrer(body.documentURL,body.url,body.referrerPolicy),userAgent,cookies,currentTime:session.time,output:this.options.output??'dummy',pauseOnReady:false,presentImmediately:true,logPath:path.join(this.runDirectory,`vlc-${session.serial}.private.log`)};
   const recordDecoder=(event,data)=>this.record('decoder',{serial:session.serial,decoderEvent:event,...data});
   const decoder=this.options.transport==='desktop'?await DesktopVLC.open(configuration,recordDecoder):new Decoder(configuration,recordDecoder);
   session.decoder=decoder;this.decoder=decoder;this.phase='buffering';this.event('playback-started');
   decoder.onEnded=()=>{if(this.session===session&&this.presented)this.close('ended').catch(error=>this.event('end-failed',{reason:error.message}))};
   decoder.onClosed=()=>{if(this.session===session&&this.presented)this.close('closed').catch(error=>this.event('close-failed',{reason:error.message}))};
   decoder.ready.then(ready=>{if(this.session===session&&this.presented){this.phase='playing';this.event('decoder-ready',{decoderReady:ready})}}).catch(error=>{if(this.session===session&&this.presented){if(error.message==='desktop-closed-before-clock-advance'){this.event('closed-without-clock-advance');return}this.phase='error';this.event('playback-error',{reason:error.message})}});
  }catch(error){
   this.event('handoff-failed',{reason:error.message});
   if(this.session===session&&this.presented){this.phase='error';this.event('playback-error',{reason:error.message})}
   else if(this.session===session){
    const action=await this.isActive(session)?(this.phase==='accepting'?'aborted':'rejected'):'cancelled';
    await this.cancel(false,action);
    }else{await session.decoder?.stop();await this.response(session,'cancelled').catch(()=>{})}
  }
 }
 async cancel(resume=true,action=resume?'rejected':'cancelled'){
  const session=this.session;if(!session||this.presented)return;
  this.session=null;this.decoder=null;this.phase='idle';await session.decoder?.stop();
  await this.response(session,action).catch(()=>{});this.event('preparation-cancelled',{resume:action==='aborted',action});
 }
 async playPause(){
  if(!this.presented){if(this.session)await this.cancel(false);return}
  const status=await this.decoder?.status();if(!status)return;this.decoder.command(status.state===3?'pause':'activate');
  await delay(150);const current=await this.decoder.status();this.phase=current.state===4?'paused':'playing';this.event('transport-toggle',{decoderState:current.state});return current;
 }
 async next(){return this.close('next')}
 async previous(){return this.close('previous')}
 async close(action='closed',{callbackPhase=this.options.callbackPhase??'completion',dismissalDelayMs=this.options.dismissalDelayMs??250}={}){
  if(!['closed','ended','next','previous'].includes(action))throw Error('unsupported-close-action');
  const session=this.session;if(!session||!this.presented)throw Error('no-presented-player');
  const status=await session.decoder?.status()??{timeMs:session.time*1000};await session.decoder?.stop();this.decoder=null;
  this.phase='dismissing';this.event('dismiss-start',{action,callbackPhase});
  const deliver=async()=>{
   // The app restores JS permission then submits the close command. Native modal
   // state may still be occupied if the callback incorrectly runs too early.
   await session.frame.page().evaluate(enabled=>{window.__browserTVSetFullscreenMediaSuspended?.(false);window.__browserTVSetIframeVLCExperiment?.(enabled,true)},this.enabled);
   const exitFullscreen=this.options.autoExit!==false&&action!=='previous';
   const sent=await this.response(session,action,(status.timeMs||0)/1000,session.body.volume,session.body.muted,exitFullscreen);
   if(sent&&(action==='next'||action==='previous')){
    const reply=await this.checkpoint(session,'track');
    if(await this.isActive(session)){
     if(reply.track==='unavailable'){
      const systemSent=await this.options.systemTrack?.({action,session})===true;
      this.event('system-track-modeled',{action,sent:systemSent});
      await this.response(session,action==='next'&&!systemSent?'trackEnd':'trackDone',0,0,false,exitFullscreen);
     }else await this.response(session,'trackDone');
    }
   }
   this.event('close-delivered',{action});
  };
  if(callbackPhase==='viewDidDisappear')await deliver();
  await delay(dismissalDelayMs);
  this.presented=false;this.session=null;this.phase='idle';this.event('dismiss-complete');
  if(callbackPhase==='completion')await deliver();
 }
 async dispose(){this.disposed=true;this.serial++;if(this.decoder)await this.decoder.stop();this.decoder=null}
}
