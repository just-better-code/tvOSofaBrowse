import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { launchLab } from './runtime.mjs';

const { values, positionals } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, app:{type:'boolean'}, bridge: { type: 'boolean' }, adblock: { type: 'boolean' }, 'native-vlc':{type:'boolean'}, 'vlc-window':{type:'boolean'}, 'desktop-vlc':{type:'boolean'}, 'user-agent':{type:'string'},
    headless: { type: 'boolean' }, ephemeral: { type: 'boolean' },
    profile: { type: 'string', default: 'default' }, viewport: { type: 'string', default: '1920x1080' },
    init: { type: 'string', multiple: true }, trace: { type: 'boolean' },
    inspector: { type: 'boolean' }, screenshot: { type: 'boolean' }, script: { type: 'string' },
}, allowPositionals: true });
if (values.help) {
    console.log(`WebKit testbench for tvOSofaBrowse
Usage: webkit-lab [options] [URL or local HTML file]
  --desktop-vlc      Immediate visible desktop VLC + RC return (use with --app); Firefox UA by default
  --user-agent TEXT  Explicit browser/media UA override, recorded in metadata
  --app              Closest available Linux mode: --bridge --adblock --native-vlc
  --vlc-window       Show an actual Linux VLC video window (requires --native-vlc)
  --native-vlc       Use modeled native handoff with actual Linux libVLC decoding (requires --bridge)
  --adblock          Enable pinned app uBO core, lists and page adapters (stand host)
  --bridge           Inject the current app click/fullscreen/media bridge in every frame
  --init FILE        Add document-start JS after the bridge (repeatable)
  --profile NAME     Persistent website storage (default: default)
  --ephemeral        Isolated temporary browser context
  --viewport WxH     CSS viewport (default: 1920x1080)
  --inspector        Open Playwright Inspector (requires a graphical session)
  --trace            Save a private trace on normal exit; may contain secrets
  --script FILE      Run an ES module's default async function, then close
  --screenshot       Save screenshot.png, then close
  --headless         No browser window; requires --script or --screenshot
Terminal commands: open URL, back, reload, center X Y, play-pause, next, player-back, inactive, active, native-status, status, screenshot, inspect, quit
Native handlers are observational by default. --native-vlc adds actual Linux libVLC with modeled UIKit/modal state. No native WK content-rule host or tvOS emulation.`);
    process.exit(0);
}

function targetURL(value) {
    if (!value) return null;
    if (/^(https?:|file:|about:blank$)/i.test(value)) return new URL(value).href;
    if (value.startsWith('/') || value.startsWith('.') || /\.html?$/i.test(value)) return pathToFileURL(path.resolve(value)).href;
    throw new Error('Use a complete https:// URL or a local HTML file path.');
}

async function main() {
    if(values.app){values.bridge=true;values.adblock=true;values['native-vlc']=true;}
    if (positionals.length > 1) throw new Error('Only one initial URL is supported.');
    const dimensions = /^(\d+)x(\d+)$/.exec(values.viewport);
    if (!dimensions || dimensions.slice(1).some(number => Number(number) < 100 || Number(number) > 7680)) throw new Error('Viewport must be WxH, each dimension between 100 and 7680.');
    if (values.headless && !values.script && !values.screenshot) throw new Error('--headless requires --script or --screenshot so it can finish.');
    if (values.headless && values.inspector) throw new Error('Inspector requires a graphical session.');
    const target = targetURL(positionals[0]);
    if(values['vlc-window']&&!values['native-vlc'])throw Error('--vlc-window requires --native-vlc');
    const lab = await launchLab({ ...values,...(values['user-agent']?{userAgent:values['user-agent']}:{}),...(values['native-vlc']?{nativeVLC:{output:values['vlc-window']?'window':'dummy'}}:{}), viewport: { width: Number(dimensions[1]), height: Number(dimensions[2]) } });
    let terminal;
    const stop = async () => { terminal?.close(); await lab.close(); };
    process.once('SIGINT', () => { stop().catch(console.error); });
    process.once('SIGTERM', () => { stop().catch(console.error); });
    console.log(`WebKit ready. Private artifacts: ${lab.runDirectory}`);
    console.log(lab.native?'Production bridge + actual Linux libVLC; UIKit/modal state modeled.':values.bridge?'App bridge enabled; native calls are observational stubs.':'Plain WebKit; use --bridge for app scripts.');
    try {
        if (target) {
            await lab.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } else {
            await lab.page.setContent(`<html lang="uk"><meta charset="utf-8"><title>WebKit testbench</title>
                <body style="font:24px system-ui;max-width:960px;margin:64px auto;padding:24px">
                <h1>WebKit testbench</h1><p>Локальний WebKit для tvOSofaBrowse.</p>
                <form><label>Адреса сайту <input name="url" type="url" placeholder="https://example.org" required style="font:inherit;width:60%"></label>
                <button style="font:inherit">Відкрити</button></form>
                <p>У терміналі: <code>open URL</code>, <code>screenshot</code>, <code>inspect</code>, <code>quit</code>.</p>
                <p>Режим: ${values.bridge ? 'скрипт застосунку + заглушки нативного моста' : 'звичайний WebKit'}.</p>
                <p>${lab.native?"Декодування виконує справжній Linux libVLC. Показ, фокус і переходи UIKit залишаються моделлю.":"Стенд перевіряє вебповедінку. Для Linux libVLC використайте --native-vlc разом із --bridge."}</p>
                <script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const u=new URL(e.target.url.value);if(/^https?:$/.test(u.protocol))location.href=u.href}</script>`);
        }
        if (values.inspector) await lab.page.pause();
        if (values.script) {
            const scenario = await import(pathToFileURL(path.resolve(values.script)));
            if (typeof scenario.default !== 'function') throw new Error('Scenario must export default async function(lab).');
            await scenario.default(lab);
        }
        if (values.screenshot) await lab.page.screenshot({ path: path.join(lab.runDirectory, 'screenshot.png') });
        if (values.script || values.screenshot) return;
        terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
        const currentPage = () => lab.context.pages().find(page => !page.isClosed()) ?? lab.page;
        terminal.setPrompt('webkit> ');
        let pending = Promise.resolve();
        terminal.on('line', line => {
            pending = pending.then(async () => {
                const input = line.trim(), page = currentPage();
                if (input === 'quit' || input === 'exit') { terminal.close(); return; }
                if (input.startsWith('open ')) await page.goto(targetURL(input.slice(5).trim()), { waitUntil: 'domcontentloaded' });
                else if (input === 'back') await page.goBack();
                else if (input === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
                else if(input==='next')await lab.native?.next();
                else if(input==='player-back')await lab.remote.back();
                else if(input==='inactive'||input==='active')await lab.native?.setActive(input==='active');
                else if(input==='native-status')console.log(lab.native?.snapshot()??{nativeHost:false});
                else if(/^center \d+ \d+$/.test(input)){const [,x,y]=input.split(' ');await lab.remote.center(Number(x),Number(y));}
                else if(input==='play-pause')await lab.remote.playPause();
                else if (input === 'status') console.log(await page.title(), page.url());
                else if (input === 'screenshot') {
                    const filename = path.join(lab.runDirectory, `screenshot-${Date.now()}.png`);
                    await page.screenshot({ path: filename }); console.log(filename);
                } else if (input === 'inspect') await page.pause();
                else if (input) console.log('Commands: open URL, back, reload, status, screenshot, inspect, quit');
            }).catch(error => console.error(error.message)).finally(() => terminal.prompt());
        });
        await new Promise(resolve => {
            terminal.once('close', resolve);
            lab.context.once('close', () => terminal.close());
            terminal.prompt();
        });
        await pending;
    } finally { await stop(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
