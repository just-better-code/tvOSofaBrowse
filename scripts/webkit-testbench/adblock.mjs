// Stand host for the app's pinned uBO components; not WKContentRuleList.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
const sources=[['dns','AdGuardDNS.txt','https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt'],...[[2,'base','Base'],[23,'ukrainian','Ukrainian'],[4,'social','Social'],[11,'mobile','Mobile'],[14,'annoyances','Annoyances']].map(([n,id,name])=>[id,`AdGuard${name}.txt`,`https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_${n}_${name}/filter.txt`])];
function bucketSource(records) {
 const groups=[],ids=new Map(),index=new Map(),fallback=[];
 records.forEach((record,ordinal)=>{
  const positives=record.domains.filter(d=>!d.exclude).map(d=>d.host);
  const broad=positives.length===0||positives.some(h=>h.startsWith('/')||h.endsWith('>>'));
  const keys=broad?[]:[...new Set(positives.map(h=>h.split('/',1)[0]))].sort();
  const signature=JSON.stringify(keys);let id=ids.get(signature);
  if(id===undefined){id=groups.length;ids.set(signature,id);groups.push([]);if(broad)fallback.push(id);else for(const key of keys){if(!index.has(key))index.set(key,[]);index.get(key).push(id)}}
  groups[id].push([ordinal,record]);
 });
 return `(function(){function buckets(host){switch(host){${[...index].map(([host,ids])=>`case ${JSON.stringify(host)}:return ${JSON.stringify(ids)};`).join('')}}return [];}function entries(id){switch(id){${groups.map((entries,id)=>`case ${id}:return JSON.parse(${JSON.stringify(JSON.stringify(entries))});`).join('')}}return [];}const chosen=new Set(${JSON.stringify(fallback)});for(let host of [hostname,entityFor(hostname),'*']){while(host){for(const id of buckets(host))chosen.add(id);const dot=host.indexOf('.');if(dot<0)break;host=host.slice(dot+1);}}const matches=[];for(const id of chosen)for(const entry of entries(id))matches.push(entry);matches.sort((a,b)=>a[0]-b[0]);return matches.map(e=>e[1]);})()`;
}
export async function installAdblock(context,{projectRoot,dataRoot,record}) {
 const root=path.join(projectRoot,'_Project/Vendor/UBlock');
 const read=name=>readFile(path.join(root,name),'utf8');
 const cache=path.join(dataRoot,'filters');await mkdir(cache,{recursive:true});
 const lists=[{id:'ubo',trusted:true,text:await read('UBlockFilters.txt')}];
 for(const [id,file,url] of sources){
  const target=path.join(cache,file);let text;
  try{text=await readFile(target,'utf8')}catch(error){
   if(error.code!=='ENOENT')throw error;
   const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`Filter download failed: ${id} ${response.status}`);
   text=await response.text();if(!text.trim()||text.startsWith('<'))throw Error(`Invalid filter list: ${id}`);
   await writeFile(target,text,{mode:0o600});
  }
  lists.push({id,trusted:false,text});
 }
 const box=vm.createContext({URL,TextDecoder,performance,setTimeout,clearTimeout,console,browserNormalizeHostname:h=>new URL('https://'+h).hostname});
 const networkSource=await read('UBlockNetwork.js');
 const traceMarker='const result = {action,engine};';
 if(!networkSource.includes(traceMarker))throw Error('Network trace marker changed; update diagnostic adapter');
 // Add only winning-rule diagnostics to the generated copy; never alter vendored source or decisions.
 vm.runInContext(networkSource.replace(traceMarker,`if (!explain && action !== 0) logData = engine === 'static' ? snfe.toLogData() : engine === 'dynamic-url' ? urls.toLogData() : firewall.toLogData();\n${traceMarker}`),box);
 const network=box.browserCompileNetwork(lists,'',await read('PublicSuffixList.dat'));
 vm.runInContext(await read('UBlockParser.js'),box);
 const library=JSON.parse(await read('UBlockScriptlets.json'));
 const compiled=box.browserCompileUBlock(lists,library),byName=new Map(library.map(e=>[e.name,e]));
 const runtime=await read('UBlockRuntime.js'),domains=await read('UBlockDomains.js');
 const procedural=await read('UBlockProcedural.js');
 const cosmetics=(await read('UBlockCosmetics.js')).replace('__BROWSER_PROCEDURAL__',()=>procedural);
 const scripts=[];
 for(const world of ['MAIN','ISOLATED']){
  const records=compiled.records.filter(r=>r.exception?(r.kind!=='cosmetic'||world==='ISOLATED'):(r.kind==='cosmetic'?world==='ISOLATED':r.world===world));
  const names=new Set(),declarations=[];
  function collect(name){const e=byName.get(name);if(!e||names.has(name))return;names.add(name);for(const d of e.dependencies||[])collect(d);declarations.push(`const ${e.functionName}=(${e.code});`)}
  for(const r of records)if(r.kind==='scriptlet'&&!r.exception)collect(r.name);
  const functions=[...names].filter(n=>n.endsWith('.js')).map(n=>`[${JSON.stringify(n)},${byName.get(n).functionName}]`).join(',');
  const parts={__BROWSER_CONFIG__:"({enabled:true,token:'webkit-stand',topHost:(location.ancestorOrigins?.length?new URL(location.ancestorOrigins[location.ancestorOrigins.length-1]).hostname:location.hostname),debug:true})",__BROWSER_DOMAINS__:domains,__BROWSER_RECORDS__:bucketSource(records),__BROWSER_FUNCTIONS__:declarations.join('\n'),__BROWSER_FUNCTION_MAP__:`[${functions}]`,__BROWSER_COSMETICS__:world==='ISOLATED'?cosmetics:''};
  scripts.push(`delete globalThis.__browserUBlockInstalled;\n`+runtime.replace(/__BROWSER_[A-Z_]+__/g,key=>{if(!(key in parts))throw Error(`Unknown runtime token ${key}`);return parts[key]}));
 }
 // Playwright WebKit has no named WKContentWorld host. Both lexical runtimes
 // execute in page world. Record this difference rather than claiming parity.
 const source=scripts.join('\n;\n');
 await context.route('**/*',async route=>{
  const request=route.request();let frame;try{frame=request.frame()}catch{return route.fallback()}
  const navigation=request.isNavigationRequest();
  const topURL=navigation&&!frame.parentFrame()?request.url():frame.page().url();
  const originURL=navigation&&frame.parentFrame()?frame.parentFrame().url():frame.url();
  const types={document:frame.parentFrame()?'sub_frame':'main_frame',xhr:'xmlhttprequest',fetch:'xmlhttprequest'};
  const result=box.browserMatchNetwork({url:request.url(),originURL:originURL==='about:blank'?topURL:originURL,topURL,type:types[request.resourceType()]||request.resourceType(),method:request.method()});
  if(result.action===1){record('adblock-block',{type:request.resourceType(),host:new URL(request.url()).hostname,rule:result.rule,engine:result.engine,frameHost:new URL(originURL==='about:blank'?topURL:originURL).hostname,topHost:new URL(topURL).hostname});return route.abort('blockedbyclient')}
  if(result.modifiedURL)return route.fallback({url:result.modifiedURL});
  return route.fallback();
 });
 return {source,metadata:{enabled:true,host:'Playwright route + page-world app adapters',nativeContentRules:false,isolatedWorld:false,networkTracePatch:'winning-rule-only-generated-copy',networkStats:network.stats,extendedRejected:compiled.rejected,lists:lists.map(l=>({id:l.id,sha256:createHash('sha256').update(l.text).digest('hex')}))}};
}
