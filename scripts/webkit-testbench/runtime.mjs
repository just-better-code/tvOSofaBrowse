import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {installAdblock} from './adblock.mjs';
import {NativeMediaHost,hostInitScript} from './native-host.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dataRoot = path.join(projectRoot, '.data/webkit-testbench');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(dataRoot, 'browsers');
process.umask(0o077);
let playwright;
try { playwright=createRequire(import.meta.url)('playwright'); } catch (error) {
    if(error.code!=='MODULE_NOT_FOUND')throw error;
    // Reuse an existing local skill installation; npm ci here is the portable path.
    playwright=createRequire(path.join(projectRoot,'.codex/skills/webkit-testbench/scripts/package.json'))('playwright');
}
const {webkit}=playwright;
const playwrightVersion=(()=>{try{return createRequire(import.meta.url)('playwright/package.json').version}catch{return createRequire(path.join(projectRoot,'.codex/skills/webkit-testbench/scripts/package.json'))('playwright/package.json').version}})();

// Read the current source on every launch; do not maintain a fork of the app bridge.
export async function productionBridge() {
    const source = await readFile(path.join(projectRoot, '_Project/Browser/BrowserWebView.m'), 'utf8');
    const media = await readFile(path.join(projectRoot, '_Project/Browser/BrowserFullscreenMediaBridge.js'), 'utf8');
    const functionStart = source.indexOf('static NSString *BrowserFrameClickBridgeScript(');
    const start = source.indexOf('return [NSString stringWithFormat:', functionStart);
    const end = source.indexOf(', secret, nativeToken, mediaBridge', start);
    if (functionStart < 0 || start < 0 || end < 0) throw new Error('Bridge template changed; update the extractor before using --bridge.');
    const strings = source.slice(start, end).match(/@?"(?:\\.|[^"\\])*"/g);
    const template = strings.map(value => JSON.parse(value.replace(/^@/, ''))).join('');
    const parts = template.split('%@');
    if (parts.length !== 4 || /%(?:@|[0-9.]*[sdfiu])/.test(parts.join(''))) {
        throw new Error('Unexpected Objective-C bridge format; refusing partial injection.');
    }
    const secret = randomUUID(), token = randomUUID();
    const content = parts[0] + secret + parts[1] + token + parts[2] + media + parts[3];
    new vm.Script(content, { filename: 'production-bridge.js' });
    return { content, sha256: createHash('sha256').update(template + media).digest('hex') };
}

function safeURL(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:', 'file:'].includes(url.protocol)) return url.protocol;
        return url.origin + url.pathname;
    } catch { return '(unknown)'; }
}

export async function launchLab(options = {}) {
    if(options.app)options={bridge:true,adblock:true,nativeVLC:true,...options};
    const profile = options.profile ?? 'default';
    if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Profile must contain only letters, digits, underscores or hyphens.');
    const nativeOptions=options.nativeVLC??options['native-vlc'];
    if(nativeOptions&&!options.bridge)throw Error('Native VLC host requires the production bridge');
    const preferences=await readFile(path.join(projectRoot,'_Project/Browser/BrowserPreferencesStore.m'),'utf8');
    const defaultUA=preferences.match(/\+ \(NSString \*\)desktopUserAgent \{\s*return @"([^"]+)"/);
    const userAgent=options.userAgent??(nativeOptions?defaultUA?.[1]:undefined);
    if(nativeOptions&&!userAgent)throw Error('App desktop user-agent source changed; update the extractor');
    const sourceFingerprints={};
    for(const name of ['BrowserWebView.m','BrowserFullscreenMediaBridge.js','ViewController.m','BrowserVLCPlayerViewController.m','BrowserPreferencesStore.m'])sourceFingerprints[name]=createHash('sha256').update(await readFile(path.join(projectRoot,'_Project/Browser',name))).digest('hex');
    const bridge = options.bridge ? await productionBridge() : null;
    const extraScripts = await Promise.all((options.init ?? []).map(filename => readFile(path.resolve(filename), 'utf8')));
    const runDirectory = path.join(dataRoot, 'runs', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const output = createWriteStream(path.join(runDirectory, 'events.jsonl'), { mode: 0o600 });
    let outputError;
    output.on('error', error => { outputError = error; console.error('Diagnostic log failed:', error.message); });
    const record = (event, fields = {}) => {
        if (!output.destroyed && !output.writableEnded) output.write(JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + '\n');
    };
    const frameStates = new WeakMap();
    let frameSerial = 0;
    function stateForFrame(frame) {
        let state = frameStates.get(frame);
        if (!state) {
            const parent = frame.parentFrame();
            state = { frameID: ++frameSerial, parentFrameID: parent ? stateForFrame(parent).frameID : null, documentGeneration: 0 };
            frameStates.set(frame, state);
        }
        return state;
    }
    const frameInfo = frame => ({ ...stateForFrame(frame), url: safeURL(frame.url()) });
    const launchOptions = { headless: options.headless ?? false, viewport: options.viewport ?? { width: 1920, height: 1080 }, deviceScaleFactor: 1, ...(userAgent?{userAgent}:{}), serviceWorkers:options.adblock?'block':'allow' };
    let browser, context,native;
    try {
        if (options.ephemeral) {
            browser = await webkit.launch({ headless: launchOptions.headless });
            context = await browser.newContext({ viewport:launchOptions.viewport,deviceScaleFactor:launchOptions.deviceScaleFactor,...(userAgent?{userAgent}:{}),serviceWorkers:launchOptions.serviceWorkers });
        } else {
            const profileDirectory = path.join(dataRoot, 'profiles', profile);
            await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
            context = await webkit.launchPersistentContext(profileDirectory, launchOptions);
        }
        native=nativeOptions?new NativeMediaHost(context,{record,runDirectory,options:{userAgent,...(typeof nativeOptions==='object'?nativeOptions:{})}}):null;
        await native?.bind();
        await context.exposeBinding('__webkitLabNativeMessage', ({ frame }, handler, body) => {
            record('native-message', { ...frameInfo(frame), frame: safeURL(frame.url()), handler, body });
            if(native)native.receive(frame,handler,body).catch(error=>record('native-host-error',{message:error.message}));
        });
        // One init script gives deterministic ordering, including on child-frame navigation.
        const nativeStub = bridge ? `(() => {
            const messages = [];
            window.__webkitLabMessages = messages;
            const handlers = new Proxy(Object.create(null), { get: (_, handler) => ({ postMessage(body) {
                messages.push({handler, body});
                if (messages.length > 100) messages.shift();
                window.__webkitLabNativeMessage(String(handler), body).catch(() => {});
                if (handler === 'browserFullscreenMedia' && body && body.loadVolume) {
                    queueMicrotask(() => window.__browserTVRestoreFullscreenVolume?.(body.session, 1));
                }
            } }) });
            window.webkit = window.webkit || {};
            window.webkit.messageHandlers = handlers;
        })();` : '';
        const protection = options.adblock ? await installAdblock(context, {projectRoot,dataRoot,record}) : null;
        const adblock = protection?.metadata ?? {enabled:false};
        await context.addInitScript({ content: [nativeStub, protection?.source ?? '', bridge?.content ?? '', ...(native?[hostInitScript]:[]), ...extraScripts].join('\n;\n') });
        if (options.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const attach = page => {
            page.on('frameattached', frame => record('frame-attached', frameInfo(frame)));
            page.on('framenavigated', frame => {
                stateForFrame(frame).documentGeneration++;
                record('frame-navigated', frameInfo(frame));
            });
            page.on('framedetached', frame => record('frame-detached', frameInfo(frame)));
            page.frames().forEach(frame => record('frame-existing', frameInfo(frame)));
            page.on('console', message => record('console', { type: message.type(), text: message.text().slice(0, 4000) }));
            page.on('pageerror', error => record('page-error', { message: error.message, stack: error.stack }));
            page.on('request', request => record('request', { method: request.method(), type: request.resourceType(), url: safeURL(request.url()) }));
            page.on('requestfailed', request => record('request-failed', { url: safeURL(request.url()), error: request.failure()?.errorText }));
            page.on('response', response => record('response', { status: response.status(), url: safeURL(response.url()) }));
            page.on('dialog', async dialog => {
                record('dialog-dismissed', { type: dialog.type() });
                await dialog.dismiss().catch(() => {});
            });
        };
        context.on('page', attach);
        context.pages().forEach(attach);
        await writeFile(path.join(runDirectory, 'environment.json'), JSON.stringify({
            playwright: playwrightVersion,
            browserVersion: context.browser()?.version(), platform: process.platform,
            viewport: launchOptions.viewport, ephemeral: !!options.ephemeral,
            bridge: !!bridge, bridgeSourceSHA256: bridge?.sha256,
            initScripts: (options.init ?? []).map(filename => path.basename(filename)),
            trace: !!options.trace, sourceFingerprints, adblock, userAgent, nativeHost:native?{decoder:'Linux libVLC (actual)',modal:'modeled',cookieReferrer:'app-policy model',configuration:native.options}:null, serviceWorkers:launchOptions.serviceWorkers, injectionOrder:['native-handler-stub',...(protection?['app-adblock']:[]),...(bridge?['production-media-bridge']:[]),...(native?['bridge-trace']:[]),'extra-init-scripts'],
        }, null, 2));
        const initialPages = context.pages();
        const page = await context.newPage();
        for (const initial of initialPages) {
            if (initial.url() === 'about:blank') await initial.close();
        }
        if(native)await native.setPage(page);
        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            try {
                await native?.dispose();
                if (options.trace) await context.tracing.stop({ path: path.join(runDirectory, 'trace.zip') });
            } finally {
                try {
                    if(browser){let timer;await Promise.race([context.close(),new Promise(resolve=>{timer=setTimeout(resolve,5000)})]);clearTimeout(timer)}
                    else await context.close();
                } finally {
                    await browser?.close();
                    await new Promise(resolve => output.end(resolve));
                }
            }
            if (outputError) throw outputError;
        };
        const remote={
            center:(x,y)=>{if(native?.presented)throw Error('UIKit focus is not emulated; use explicit native host transport commands');return page.evaluate(({x,y})=>window.__browserTVFrameClick?.(x,y,Date.now()),{x,y})},
            playPause:()=>native?.presented||native?.session?native.playPause():page.evaluate(()=>window.__browserTVToggleVideo?.()),
            back:async()=>{if(native?.presented)return native.close('closed');if(native?.session)return native.cancel(true);return page.evaluate(()=>window.__browserTVExitFullscreen?.())},
        };
        return { context, page, runDirectory, record, native, remote, close };
    } catch (error) {
        await context?.close().catch(() => {});
        await browser?.close().catch(() => {});
        output.end();
        throw error;
    }
}
