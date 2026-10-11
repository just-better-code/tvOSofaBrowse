/* Isolated-realm worker bridge regressions. Does not model WebKit CSP or scheduling. */
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
const common = () => ({ Request, Response, Event, EventTarget, DOMException, URL: FixtureURL, Blob: FixtureBlob,
    ArrayBuffer, Uint8Array, URLSearchParams, FormData, ProgressEvent: Event, performance, setTimeout, clearTimeout,
    fetch: async () => { counts.fetch++; return new Response('native'); } });
class Worker extends EventTarget {
    constructor(url, options) {
        super(); this.url = url; this.options = options; this.incoming = [];
        const blob = objects.get(url); if (!blob) { this.bypassed = true; return; }
        setTimeout(() => {
            if (this.dead) return;
            const bus = new EventTarget(); this.bus = bus;
            this.realm = vm.createContext({...common(), XMLHttpRequest: XHR, location: {href: url},
                addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus),
                postMessage: data => { if (!this.dead) this.dispatchEvent(message(data)); },
                importScripts: entry => {
                    const original = objects.get(entry); assert.ok(original, 'entry URL must survive immediate site revocation');
                    vm.runInContext(original.source, this.realm);
                }
            });
            vm.runInContext(blob.source, this.realm);
            for (const e of this.incoming.splice(0)) bus.dispatchEvent(e);
        }, 0);
    }
    postMessage(data, ports) { const e = message(data, ports); if (this.bus) this.bus.dispatchEvent(e); else this.incoming.push(e); }
    terminate() { this.dead = true; }
}
const bus = new EventTarget(), page = vm.createContext({...common(), Worker, MessageChannel: Channel,
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
    await pause(30); return {worker, output};
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
        bus.dispatchEvent(new Event('pagehide')); await pause(10); reply({action:0}); await pause(10);
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
    await check('module and HTTP workers retain native entry', async () => {
        const m = new page.Worker('https://example.org/module.js', {type:'module',name:'m'});
        assert.equal(m.url,'https://example.org/module.js'); assert.equal(m.options.type,'module');
        assert.ok(events.includes('worker-ready')); assert.ok(events.includes('worker-bypass')); m.terminate();
    });
})().catch(e=>{console.error(e);process.exitCode=1;});
