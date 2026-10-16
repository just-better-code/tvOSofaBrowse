// The full uBO task engine uses this small browser-owned vAPI adapter.
const styles = new Set();
const vAPI = {
    hideStyle:'display:none!important;',
    randomToken:() => 'data-bubo-' + Math.random().toString(36).slice(2),
};
__BROWSER_PROCEDURAL__
let pending = false, stopped = false, observer, timer, cssTimer;
const domFilterer = {
    addCSS(css) {
        const style = document.createElement('style'); style.textContent = css; styles.add(style);
        (document.head || document.documentElement)?.appendChild(style);
    },
    commit() { schedule(); }, hasListeners:() => false,
};
const procedural = new vAPI.DOMProceduralFilterer(domFilterer);
vAPI.domFilterer = { proceduralFilterer:procedural };
const selectors = [], css = [];
const seen = new Set();
for (const rule of rules) {
    if (rule.kind !== 'cosmetic' || rule.exception || !allowed(rule) || seen.has(rule.key)) continue;
    seen.add(rule.key);
    if (typeof rule.compiled === 'string') { css.push({rule, selector:rule.compiled}); continue; }
    try {
        const selector = procedural.createProceduralFilter(rule.compiled);
        selectors.push({rule, selector, next:0});
    } catch { emit('cosmetic-error', rule); }
}
let cursor = 0, previous = new Set(), running = false;
function schedule() {
    if (stopped || pending) return;
    pending = true;
    timer = setTimeout(tick, 100);
}
function tick() {
    pending = false;
    if (stopped || !document.documentElement) return;
    if (!running) {
        previous = procedural.styledNodes; procedural.styledNodes = new Set(); cursor = 0; running = true;
    }
    const start = performance.now();
    while (cursor < selectors.length) {
        const item = selectors[cursor++];
        const before = performance.now();
        if (Date.now() < item.next) {
            for (const node of item.nodes || []) procedural.styledNodes.add(node);
            continue;
        }
        try {
            // Pause and retry on a later mutation rather than permanently dropping rules.
            // A query itself cannot be interrupted: cap document size before full scans.
            if (document.getElementsByTagName('*').length > 15000) {
                for (const node of item.nodes || []) procedural.styledNodes.add(node);
                emit('cosmetic-deferred', item.rule); continue;
            }
            const nodes = item.selector.exec();
            item.nodes = nodes;
            procedural.processNodes(nodes, item.selector.action);
            if (nodes.length) emit('cosmetic-match', item.rule, nodes.length);
        } catch { emit('cosmetic-error', item.rule); }
        const cost = performance.now() - before;
        if (cost > 8) { item.next = Date.now() + Math.min(10000, cost * 100); emit('cosmetic-budget', item.rule, Math.ceil(cost)); }
        if (performance.now() - start > 8) break;
    }
    if (cursor < selectors.length) { schedule(); return; }
    procedural.unprocessNodes(previous); running = false;
}
function start() {
    if (stopped || !document.documentElement) return;
    // Separate CSS rules: one unsupported selector must not invalidate the others.
    const style = document.createElement('style'); styles.add(style);
    (document.head || document.documentElement).appendChild(style);
    let cssCursor = 0;
    function installCSS() {
        if (stopped) return;
        const start = performance.now();
        while (cssCursor < css.length) {
            const item = css[cssCursor++];
            try { style.sheet.insertRule(`${item.selector}{${vAPI.hideStyle}}`, style.sheet.cssRules.length); }
            catch { emit('cosmetic-error', item.rule); }
            if (performance.now() - start > 8) break;
        }
        if (cssCursor < css.length) cssTimer = setTimeout(installCSS, 16);
    }
    installCSS();
    observer = new MutationObserver(records => {
        if (records.every(r => r.type === 'attributes' && r.attributeName?.startsWith('data-bubo-'))) return;
        schedule();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true, attributes:true, characterData:true});
    schedule();
}
function stop() {
    stopped = true; observer?.disconnect(); clearTimeout(timer); clearTimeout(cssTimer); pending = false;
    for (const node of procedural.styledNodes) {
        node.removeAttribute(procedural.masterToken);
        for (const token of procedural.styleTokenMap.values()) node.removeAttribute(token);
    }
    for (const style of styles) style.remove(); styles.clear();
}
addEventListener('pagehide', event => { if (!event.persisted) stop(); else { observer?.disconnect(); clearTimeout(timer); pending=false; } });
addEventListener('pageshow', event => { if (event.persisted && !stopped) { observer?.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true}); schedule(); } });
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, {once:true}); else start();
