/* Gate regressions; real WebKit/WPT checks remain necessary for browser semantics. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class XHR extends EventTarget {
    constructor() { super(); this.state = 0; this.deadline = 0; this.credentials = false; this.upload = new EventTarget(); this.sent = []; }
    open(method, url) { this.state = 1; this.url = url; }
    send(body) {
        if (this.state !== 1) throw new DOMException('', 'InvalidStateError');
        this.sent.push(body); this.state = 4; this.dispatchEvent(new Event('loadend'));
    }
    // An OPENED native request with no native send stays OPENED when aborted.
    abort() { if (this.state !== 1) this.state = 0; }
    setRequestHeader() {}
    get readyState() { return this.state; }
    get timeout() { return this.deadline; }
    set timeout(value) { this.deadline = Number(value); }
    get withCredentials() { return this.credentials; }
    set withCredentials(value) { this.credentials = Boolean(value); }
}
let decision = () => Promise.resolve({ action: 0 });
let nativeFetches = 0;
const page = new EventTarget();
const box = { Request, Response, Event, EventTarget, DOMException, URL, URLSearchParams,
    ArrayBuffer, Uint8Array, Blob, FormData, ProgressEvent: Event, performance, setTimeout, clearTimeout,
    document: { baseURI: 'https://example.org/' }, location: { href: 'https://example.org/' },
    XMLHttpRequest: XHR, fetch: async () => { nativeFetches++; return new Response('ok'); },
    addEventListener: page.addEventListener.bind(page),
    webkit: { messageHandlers: { browserNetwork: { postMessage: m => m.kind === 'match' ? decision(m) : Promise.resolve() } } }
};
vm.createContext(box);
const source = fs.readFileSync('_Project/Vendor/UBlock/UBlockRequests.js', 'utf8');
vm.runInContext(source.replace('__BROWSER_CONFIG__', '{token:"test"}'), box);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const xhr = () => { const x = new XHR(); x.open('GET', 'https://example.org/resource'); return x; };
async function check(name, fn) { await fn(); console.log('PASS ' + name); }
(async () => {
    await check('allowed fetch reaches native networking', async () => {
        assert.equal(await (await box.fetch('https://example.org/')).text(), 'ok'); assert.equal(nativeFetches, 1);
    });
    await check('blocked fetch never reaches native networking', async () => {
        decision = () => Promise.resolve({action: 1});
        await assert.rejects(box.fetch('https://example.org/ad'), {name: 'TypeError'}); assert.equal(nativeFetches, 1);
    });
    await check('abort during decision discards late allow', async () => {
        let reply; decision = () => new Promise(resolve => { reply = resolve; });
        const controller = new AbortController();
        const request = box.fetch('https://example.org/', {signal: controller.signal}); controller.abort();
        await assert.rejects(request, {name: 'AbortError'}); reply({action: 0}); await tick(); assert.equal(nativeFetches, 1);
    });
    await check('missing bridge reply falls back to native fetch', async () => {
        decision = () => new Promise(() => {});
        assert.equal(await (await box.fetch('https://example.org/')).text(), 'ok'); assert.equal(nativeFetches, 2);
    });
    await check('XHR pending-send guards and abort state', async () => {
        let reply; decision = () => new Promise(resolve => { reply = resolve; });
        const x = xhr(), events = [];
        for (const type of ['abort','loadend']) x.addEventListener(type, () => events.push([type, x.readyState]));
        x.send(); assert.throws(() => x.send(), {name:'InvalidStateError'});
        assert.throws(() => x.setRequestHeader('x','1'), {name:'InvalidStateError'});
        x.abort(); assert.equal(x.readyState, 0); assert.deepEqual(events, [['abort',4],['loadend',4]]);
        assert.throws(() => x.send(), {name:'InvalidStateError'});
        reply({action:0}); await tick(); assert.equal(x.sent.length, 0);
    });
    await check('blocked XHR completes once and requires new open', async () => {
        decision = () => Promise.resolve({action:1}); const x = xhr(); let errors=0, ends=0;
        x.addEventListener('error', () => errors++); x.addEventListener('loadend', () => ends++);
        x.send(); await tick(); assert.equal(x.readyState,4); assert.equal(errors,1); assert.equal(ends,1);
        assert.throws(() => x.send(), {name:'InvalidStateError'}); assert.equal(x.sent.length,0);
    });
    await check('reopen discards obsolete gate result', async () => {
        const replies=[]; decision=()=>new Promise(resolve=>replies.push(resolve)); const x=xhr();
        x.send(); x.open('GET','https://example.org/new'); x.send();
        replies[0]({action:1}); replies[1]({action:0}); await tick(); assert.equal(x.sent.length,1); assert.equal(x.readyState,4);
    });
    await check('XHR timeout includes decision wait', async () => {
        let reply; decision=()=>new Promise(resolve=>{reply=resolve;}); const x=xhr(); let timeouts=0;
        x.timeout=1; x.addEventListener('timeout',()=>timeouts++); x.send(); await tick();
        assert.equal(timeouts,1); assert.equal(x.readyState,4); reply({action:0}); await tick(); assert.equal(x.sent.length,0);
    });
    await check('mutable POST body is snapshotted before gate', async () => {
        let reply; decision=()=>new Promise(resolve=>{reply=resolve;}); const x=xhr(); x.open('POST','https://example.org/');
        const body=new Uint8Array([1,2]); x.send(body); body[0]=9; reply({action:0}); await tick();
        assert.deepEqual(Array.from(x.sent[0]),[1,2]);
    });
    await check('pagehide cancels pending fetch and late allow', async () => {
        let reply; decision=()=>new Promise(resolve=>{reply=resolve;}); const request=box.fetch('https://example.org/');
        page.dispatchEvent(new Event('pagehide')); await assert.rejects(request,{name:'AbortError'});
        reply({action:0}); await tick(); assert.equal(nativeFetches,2);
        page.dispatchEvent(new Event('pageshow')); decision=()=>Promise.resolve({action:0});
        await box.fetch('https://example.org/'); assert.equal(nativeFetches,3);
    });
})().catch(error=>{console.error(error); process.exitCode=1;});
