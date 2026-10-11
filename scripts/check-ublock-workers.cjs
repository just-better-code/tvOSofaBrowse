/* Run: node --experimental-vm-modules scripts/check-ublock-workers.cjs
 * Isolated-realm bridge regressions; WebKit CSP and true thread scheduling need live checks. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('_Project/Vendor/UBlock/UBlockRequests.js', 'utf8');
const objects = new Map(), counts = { fetch: 0, decisions: 0 }, events = [];
let nextURL = 0, decision = async () => ({action: 0});
class FixtureBlob { constructor(parts, options = {type:'text/javascript'}) { this.type = options.type || ''; this.source = parts.map(p => p instanceof FixtureBlob ? p.source : String(p)).join(''); } }
class FixtureURL extends URL {
    static createObjectURL(blob) { const url = 'blob:https://example.org/' + ++nextURL; objects.set(url, blob); return url; }
    static revokeObjectURL(url) { objects.delete(String(url)); }
}
class Port {
    postMessage(data) { const peer = this.peer; setTimeout(() => { if (!peer.closed && peer.onmessage) peer.onmessage({data}); }, 0); }
    close() { this.closed = true; }
}
class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; } }
function message(data, ports = []) { const e = new Event('message'); e.data = data; e.ports = ports; return e; }
class XHR extends EventTarget {
    constructor() { super(); this.state = 0; this.deadline = 0; this.credentials = false; this.upload = new EventTarget(); }
    open() { this.state = 1; } send() { counts.xhr = (counts.xhr || 0) + 1; this.state = 4; } abort() {}
    setRequestHeader() {} get readyState() { return this.state; }
    get timeout() { return this.deadline; } set timeout(v) { this.deadline = v; }
    get withCredentials() { return this.credentials; } set withCredentials(v) { this.credentials = v; }
}
function realmURL() {
    class RealmURL extends URL {}
    Object.defineProperties(RealmURL, {
        createObjectURL: Object.getOwnPropertyDescriptor(FixtureURL, 'createObjectURL'),
        revokeObjectURL: Object.getOwnPropertyDescriptor(FixtureURL, 'revokeObjectURL')
    });
    return RealmURL;
}
function realmXHR() {
    class RealmXHR extends XHR {}
    for (const name of ['open','send','abort','setRequestHeader','readyState','timeout','withCredentials'])
        Object.defineProperty(RealmXHR.prototype,name,Object.getOwnPropertyDescriptor(XHR.prototype,name));
    return RealmXHR;
}
function realmWorker() {
    class RealmWorker extends Worker {}
    for (const name of ['postMessage','terminate'])
        Object.defineProperty(RealmWorker.prototype,name,Object.getOwnPropertyDescriptor(Worker.prototype,name));
    return RealmWorker;
}
const common = () => ({ Request, Response, Event, EventTarget, DOMException, URL: realmURL(), Blob: FixtureBlob,
    Worker: realmWorker(), MessageChannel: Channel, crypto: {randomUUID: () => 'fixture-' + nextURL},
    ArrayBuffer, Uint8Array, URLSearchParams, FormData, ProgressEvent: Event, performance, setTimeout, clearTimeout,
    fetch: async () => { counts.fetch++; return new Response('native'); } });
class Worker extends EventTarget {
    constructor(url, options) {
        super(); this.url = url; this.options = options; this.incoming = [];
        const blob = objects.get(url); if (!blob) { this.bypassed = true; return; }
        setTimeout(async () => {
            if (this.dead) return;
            const bus = new EventTarget(); this.bus = bus;
            this.realm = vm.createContext({...common(), XMLHttpRequest: realmXHR(), location: {href: url},
                addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus),
                postMessage: data => { if (!this.dead) { const event=message(data); this.dispatchEvent(event); if (this.onmessage) this.onmessage(event); } },
                close: () => { this.dead = true; },
                importScripts: entry => {
                    const original = objects.get(entry); assert.ok(original, 'entry URL must survive immediate site revocation');
                    vm.runInContext(original.source, this.realm);
                }
            });
            try {
                if (options && options.type === 'module') {
                    assert.equal(typeof vm.SourceTextModule, 'function', 'run with --experimental-vm-modules');
                    const modules = new Map();
                    const getModule = entry => {
                        if (modules.has(entry)) return modules.get(entry);
                        const content = objects.get(entry); assert.ok(content, 'module URL must remain available for linking');
                        const module = new vm.SourceTextModule(content.source, {
                            context: this.realm, identifier: entry,
                            initializeImportMeta: meta => { meta.url = entry; }
                        });
                        modules.set(entry, module); return module;
                    };
                    const root = getModule(url);
                    await root.link(specifier => getModule(specifier)); await root.evaluate();
                } else vm.runInContext(blob.source, this.realm);
                this.loaded = true;
                if (!this.dead) for (const e of this.incoming.splice(0)) bus.dispatchEvent(e);
            } catch (error) { this.error = error; this.dispatchEvent(message({fixtureError:error.message})); }

        }, 0);
    }
    postMessage(data, ports) { const e = message(data, ports); if (this.loaded) this.bus.dispatchEvent(e); else this.incoming.push(e); }
    terminate() { this.dead = true; }
}
const bus = new EventTarget(), page = vm.createContext({...common(),
    crypto: {randomUUID: () => 'fixture-' + nextURL}, document: {}, location: {href: 'https://example.org/'},
    addEventListener: bus.addEventListener.bind(bus),
    webkit: {messageHandlers: {browserNetwork: {postMessage: m => {
        if (m.kind === 'match') { counts.decisions++; return decision(m); }
        if (m.kind === 'event') events.push(m.event);
        return Promise.resolve({action: 0});
    }}}}
});
vm.runInContext(source.replace('__BROWSER_CONFIG__', '{token:"fixture"}'), page);
const pause = n => new Promise(r => setTimeout(r, n));
async function start(code, options) {
    const url = page.URL.createObjectURL(new FixtureBlob([code]));
    const worker = new page.Worker(url, options); page.URL.revokeObjectURL(url);
    const output = []; worker.addEventListener('message', e => output.push(e.data));
    await pause(40); if (worker.error) throw worker.error; return {worker, output};
}
async function check(name, fn) { await fn(); console.log('PASS ' + name); }
(async () => {
    await check('initial worker fetch goes through bridge before site code runs', async () => {
        const {worker, output} = await start("fetch('https://example.org/a').then(r=>r.text()).then(postMessage)");
        assert.equal(counts.decisions, 1); assert.equal(counts.fetch, 1); assert.deepEqual(output, ['native']); worker.terminate();
    });
    await check('worker block keeps request out of native networking', async () => {
        decision = async () => ({action:1});
        const {worker, output} = await start("fetch('https://example.org/ad').catch(e=>postMessage(e.name))");
        assert.deepEqual(output, ['TypeError']); assert.equal(counts.fetch, 1); worker.terminate();
    });
    await check('worker asynchronous XHR uses same block decision', async () => {
        const {worker, output} = await start("const x=new XMLHttpRequest();x.open('GET','https://example.org/ad');x.onerror=()=>{};x.addEventListener('error',()=>postMessage('blocked'));x.send()");
        assert.deepEqual(output, ['blocked']); assert.equal(counts.xhr || 0, 0); worker.terminate();
    });
    await check('site messages and original strict directive survive bootstrap', async () => {
        const {worker, output} = await start("'use strict';postMessage((function(){return this===undefined})());addEventListener('message',e=>postMessage(e.data));");
        worker.postMessage('echo'); await pause(10); assert.deepEqual(output, [true, 'echo']); worker.terminate();
    });
    await check('page suspension cancels delayed worker allow; resume permits new request', async () => {
        let reply; decision = () => new Promise(r => { reply = r; });
        const {worker, output} = await start("fetch('https://example.org/slow').catch(e=>postMessage(e.name));addEventListener('message',()=>fetch('https://example.org/new').then(()=>postMessage('resumed')))");
        const hidden=new Event('pagehide');hidden.persisted=true;bus.dispatchEvent(hidden); await pause(10); reply({action:0}); await pause(10);
        assert.deepEqual(output, ['AbortError']); assert.equal(counts.fetch,1);
        bus.dispatchEvent(new Event('pageshow')); decision = async () => ({action:0}); await pause(10);
        worker.postMessage('go'); await pause(20); assert.deepEqual(output,['AbortError','resumed']); worker.terminate();
    });
    await check('missing native reply has bounded native fallback', async () => {
        decision = () => new Promise(() => {});
        const {worker, output} = await start("fetch('https://example.org/timeout').then(()=>postMessage('fallback'))");
        await pause(330); assert.deepEqual(output,['fallback']); worker.terminate();
    });
    await check('termination ignores outstanding replies and releases wrapper URLs', async () => {
        let reply; decision = () => new Promise(r=>{reply=r;});
        const {worker, output} = await start("fetch('https://example.org/slow').then(()=>postMessage('late'))");
        worker.terminate(); reply({action:0}); await pause(10); assert.deepEqual(output,[]); assert.equal(objects.size,0);
    });
    await check('untracked workers do not pre-read option getters', async () => {
        let reads=0; const options={get type(){reads++;return 'module';}};
        const worker=new page.Worker('https://example.org/raw.js',options);
        assert.equal(reads,0); assert.equal(worker.options,options); worker.terminate();
    });
    await check('non-JavaScript Blob retains native entry', async () => {
        const url=page.URL.createObjectURL(new FixtureBlob([''],{type:'text/plain'}));
        const worker=new page.Worker(url); assert.equal(worker.url,url);
        worker.terminate(); page.URL.revokeObjectURL(url);
    });
    await check('nested worker fetch reaches host and readiness counts once per worker', async () => {
        const before=counts.fetch, ready=events.filter(e=>e==='worker-ready').length;
        decision=async()=>({action:0});
        const child="postMessage(!!globalThis.__browserNetworkRequestsInstalled);fetch('https://example.org/nested').then(()=>postMessage('child-fetch'))";
        const code="const url=URL.createObjectURL(new Blob(["+JSON.stringify(child)+"],{type:'text/javascript'}));const child=new Worker(url);URL.revokeObjectURL(url);child.onmessage=e=>postMessage(e.data);";
        const {worker,output}=await start(code); await pause(20);
        assert.deepEqual(output,[true,'child-fetch']); assert.equal(counts.fetch,before+1);
        assert.equal(events.filter(e=>e==='worker-ready').length-ready,2); worker.terminate();
    });
    await check('page lifecycle reaches descendant gates and rejects late allow', async () => {
        let reply; const before=counts.fetch;
        decision=()=>new Promise(r=>{reply=r;});
        const child="fetch('https://example.org/nested-slow').catch(e=>postMessage(e.name));";
        const code="const url=URL.createObjectURL(new Blob(["+JSON.stringify(child)+"],{type:'text/javascript'}));const child=new Worker(url);URL.revokeObjectURL(url);child.onmessage=e=>postMessage(e.data);";
        const {worker,output}=await start(code);
        const hidden=new Event('pagehide');hidden.persisted=true;bus.dispatchEvent(hidden);await pause(30);
        assert.ok(reply);reply({action:0});await pause(20);
        assert.deepEqual(output,['AbortError']);assert.equal(counts.fetch,before);
        bus.dispatchEvent(new Event('pageshow'));await pause(10);worker.terminate();
    });
    await check('module setup precedes static dependency fetch and keeps module scope', async () => {
        const dependency=page.URL.createObjectURL(new FixtureBlob(["export const installed=!!globalThis.__browserNetworkRequestsInstalled;fetch('https://example.org/module-ad').catch(e=>postMessage(e.name));"]));
        decision=async()=>({action:1}); const before=counts.fetch;
        const {worker,output}=await start('import {installed} from '+JSON.stringify(dependency)+";const local=1;postMessage({installed,strict:(function(){return this===undefined})(),scoped:globalThis.local===undefined,meta:import.meta.url.startsWith('blob:')});addEventListener('message',e=>postMessage(e.data));",{type:'module',name:'fixture',credentials:'omit'});
        worker.postMessage('module-echo'); await pause(10);
        assert.equal(output[0].installed,true); assert.equal(output[0].strict,true); assert.equal(output[0].scoped,true); assert.equal(output[0].meta,true);
        assert.ok(output.includes('TypeError')); assert.ok(output.includes('module-echo')); assert.equal(counts.fetch,before);
        assert.equal(worker.options.credentials,'omit'); worker.terminate(); page.URL.revokeObjectURL(dependency);
    });
    await check('module worker may create an instrumented nested module worker', async () => {
        decision=async()=>({action:0});
        const child="postMessage(!!globalThis.__browserNetworkRequestsInstalled);fetch('https://example.org/nested-module').then(()=>postMessage('module-child'))";
        const code="const url=URL.createObjectURL(new Blob(["+JSON.stringify(child)+"],{type:'text/javascript'}));const child=new Worker(url,{type:'module'});URL.revokeObjectURL(url);child.onmessage=e=>postMessage(e.data);";
        const {worker,output}=await start(code,{type:'module'});await pause(30);
        assert.deepEqual(output,[true,'module-child']); worker.terminate();
    });
    await check('worker self-close reports closure after connection', async () => {
        const before=events.filter(e=>e==='worker-closed').length;
        const {worker}=await start("addEventListener('message',()=>close());");worker.postMessage('close');await pause(20);
        assert.equal(events.filter(e=>e==='worker-closed').length,before+1); worker.terminate();
    });
    await check('departing document disposes pending worker channels', async () => {
        let reply; decision=()=>new Promise(r=>{reply=r;});
        const {worker,output}=await start("fetch('https://example.org/leaving').then(()=>postMessage('late')).catch(()=>{})");
        bus.dispatchEvent(new Event('pagehide'));assert.ok(reply);reply({action:0});await pause(20);
        assert.deepEqual(output,[]);assert.equal(objects.size,0);worker.terminate();
    });
    await check('module and HTTP workers retain native entry', async () => {
        const m = new page.Worker('https://example.org/module.js', {type:'module',name:'m'});
        assert.equal(m.url,'https://example.org/module.js'); assert.equal(m.options.type,'module');
        assert.ok(events.includes('worker-ready')); assert.ok(events.includes('worker-bypass')); m.terminate();
    });
})().catch(e=>{console.error(e);process.exitCode=1;});
