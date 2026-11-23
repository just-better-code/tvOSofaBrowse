// Visible desktop transport for the agreed simple takeover baseline. No UI emulation.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {open} from 'node:fs/promises';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class DesktopVLC {
 static async open(configuration,record){
  if(configuration.cookies?.length)throw Error('desktop-vlc-required-cookie-store-unavailable');
  if(/[\r\n]/.test((configuration.userAgent||'')+(configuration.referrer||'')))throw Error('invalid-http-context');
  const log=await open(configuration.logPath,'a',0o600);
  return new DesktopVLC(configuration,record,log);
 }
 constructor(configuration,record,log){
  this.configuration=configuration;this.record=record;this.log=log;this.writes=Promise.resolve();
  this.numeric=[];this.last={lengthMs:Math.max(0,configuration.duration||0)*1000,timeMs:Math.max(0,configuration.currentTime||0)*1000,state:3};this.requestedStop=false;
  // These MUST be per-input options after the URL: global --http-user-agent was
  // experimentally shown to leave VLC/3.x headers on adaptive HLS requests.
  const args=['--no-one-instance','--no-playlist-enqueue','--play-and-exit','--extraintf=rc','--rc-fake-tty','--network-caching=2000',
   ...(configuration.output==='dummy'?['--intf=dummy','--vout=dummy','--aout=dummy']:[]),
   configuration.url,':start-time='+Math.max(0,configuration.currentTime||0),':http-user-agent='+configuration.userAgent,
   ...(configuration.referrer?[':http-referrer='+configuration.referrer]:[])];
  this.process=spawn(configuration.executable||'/usr/bin/vlc',args,{stdio:['pipe','pipe',log.fd]});
  this.process.stdin.on('error',()=>{});
  this.closed=new Promise(resolve=>this.resolveClosed=resolve);
  this.started=new Promise((resolve,reject)=>{this.process.once('spawn',()=>{record('desktop-started',{output:configuration.output||'window',networkCacheMs:2000,positionResolutionMs:1000});resolve()});this.process.once('error',reject)});
  this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject});
  // Readiness remains observational. It never gates presentation or audio.
  this.ready.catch(()=>{});
  this.process.stdout.on('data',data=>{this.writes=this.writes.then(()=>log.write(data)).catch(()=>{})});
  this.lines=createInterface({input:this.process.stdout,terminal:false});
  this.lines.on('line',line=>{
   const time=/^(?:>\s*)*(\d+)\s*$/.exec(line);
   if(time){const field=this.numeric.shift()||'timeMs';this.last[field]=Number(time[1])*1000;if(field==='lengthMs')return;record('desktop-time',{timeMs:this.last.timeMs});if(this.last.timeMs>=((configuration.currentTime||0)+1)*1000)this.resolveReady({event:'clock-advanced',timeMs:this.last.timeMs,positionResolutionMs:1000})}
   const state=/state\s+(playing|paused|stopped)/i.exec(line);
   if(state)this.last.state=state[1].toLowerCase()==='playing'?3:state[1].toLowerCase()==='paused'?4:5;
  });
  this.clock=setInterval(()=>{this.number('timeMs','get_time');this.number('lengthMs','get_length')},400);
  this.process.once('error',error=>{record('desktop-error',{code:error.code});this.rejectReady(error)});
  this.process.once('close',async code=>{
   clearInterval(this.clock);this.lines.close();await this.writes;await log.close();
   const nearEnd=Number.isFinite(configuration.duration)&&configuration.duration>0&&configuration.duration-this.last.timeMs/1000<=2;
   record('desktop-closed',{code,timeMs:this.last.timeMs,nearEnd});this.resolveClosed({code,...this.last,nearEnd});this.rejectReady(Error('desktop-closed-before-clock-advance'));
   if(!this.requestedStop)this.onClosed?.({code,...this.last,nearEnd});
  });
 }
 number(field,command){if(this.process.exitCode===null&&!this.process.stdin.destroyed){this.numeric.push(field);this.send(command)}}
 send(command){if(this.process.exitCode===null&&!this.process.stdin.destroyed)this.process.stdin.write(command+'\n')}
 command(action,values={}){
  if(action==='status'){this.number('timeMs','get_time');this.number('lengthMs','get_length');}
  else if(action==='pause'){if(this.last.state===3){this.send('pause');this.last.state=4}}
  else if(action==='activate'){if(this.last.state===4){this.send('play');this.last.state=3}}
  else if(action==='seek')this.send('seek '+Math.max(0,Number(values.time)||0));
  else if(action==='stop')this.send('quit');
 }
 async status(){if(this.process.exitCode!==null)return this.last;this.number('timeMs','get_time');this.number('lengthMs','get_length');await delay(100);return this.last}
 async stop(){
  this.requestedStop=true;if(this.process.exitCode!==null)return this.closed;
  this.send('quit');await Promise.race([this.closed,delay(2000)]);
  if(this.process.exitCode===null){this.process.kill('SIGTERM');await Promise.race([this.closed,delay(1000)])}
  return this.last;
 }
}
