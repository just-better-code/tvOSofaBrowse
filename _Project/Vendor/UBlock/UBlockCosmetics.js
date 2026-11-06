// The full uBO task engine uses this small browser-owned vAPI adapter.
const styles = new Set();
const vAPI = {
    hideStyle:'display:none!important;',
    randomToken:() => 'data-bubo-' + Math.random().toString(36).slice(2),
};
__BROWSER_PROCEDURAL__
let pending = false, stopped = false, observer, timer, cssTimer, surveyTimer, surveyPending = false, cssStyle;
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
const deferredCSS = new Map();
const seen = new Set();
for (const rule of rules) {
    if (rule.kind !== 'cosmetic' || rule.exception || !allowed(rule) || seen.has(rule.key)) continue;
    seen.add(rule.key);
    if (typeof rule.compiled === 'string') {
        const simple = /^([.#])(-?[A-Za-z_][A-Za-z0-9_-]*)$/.exec(rule.compiled);
        if (simple && !(rule.domains || []).some(domain => !domain.exclude)) {
            const key = `${simple[1]}${simple[2]}`;
            let entries = deferredCSS.get(key);
            if (!entries) deferredCSS.set(key, entries = []);
            entries.push({rule, selector:rule.compiled});
        } else css.push({rule, selector:rule.compiled});
        continue;
    }
    try {
        const selector = procedural.createProceduralFilter(rule.compiled);
        selectors.push({rule, selector, next:0});
    } catch { emit('cosmetic-error', rule); }
}
let cursor = 0, previous = new Set(), running = false;
const surveyRoots = [];
let surveyRootIndex = 0, surveyWalker = null;
const installedCSS = new Set();
const queuedCSS = new Set(), cssWork = [];
let cssWorkCursor = 0;
function installCSSItem(item, style) {
    if (installedCSS.has(item.rule.key)) return;
    try { style.sheet.insertRule(`${item.selector}{${vAPI.hideStyle}}`, style.sheet.cssRules.length); installedCSS.add(item.rule.key); }
    catch { emit('cosmetic-error', item.rule); }
}
function queueCSS(item) {
    if (installedCSS.has(item.rule.key) || queuedCSS.has(item.rule.key)) return;
    queuedCSS.add(item.rule.key); cssWork.push(item);
}
function surveyElement(element) {
    if (!element || element.nodeType !== 1) return;
    const keys = [];
    if (element.id) keys.push(`#${element.id}`);
    if (element.classList) for (const name of element.classList) keys.push(`.${name}`);
    for (const key of keys) {
        const entries = deferredCSS.get(key);
        if (entries) for (const item of entries) queueCSS(item);
    }
}
function queueSurvey(root) {
    if (!deferredCSS.size || !root || ![1, 9, 11].includes(root.nodeType)) return;
    if (surveyRoots.length - surveyRootIndex >= 256) {
        // Coalesce a mutation flood into a fresh bounded walk of the current tree.
        surveyRoots.length = 0; surveyRootIndex = 0;
        // Finish the active walk: restarting it on every flood can starve
        // selectors near the end of a continuously mutating document.
        if (document.documentElement) surveyRoots.push(document.documentElement);
        return;
    }
    surveyRoots.push(root);
}
function scheduleSurvey() {
    if (stopped || surveyPending || !cssStyle) return;
    surveyPending = true;
    surveyTimer = setTimeout(surveyTick, 0);
}
function surveyTick() {
    surveyPending = false;
    if (stopped || !cssStyle) return;
    const start = performance.now();
    while (performance.now() - start < 8) {
        if (cssWorkCursor < cssWork.length) {
            const item = cssWork[cssWorkCursor++];
            queuedCSS.delete(item.rule.key);
            installCSSItem(item, cssStyle);
            continue;
        }
        if (cssWorkCursor) { cssWork.length = 0; cssWorkCursor = 0; }
        if (!surveyWalker) {
            if (surveyRootIndex >= surveyRoots.length) {
                surveyRoots.length = 0; surveyRootIndex = 0;
                return;
            }
            const root = surveyRoots[surveyRootIndex++];
            surveyElement(root);
            surveyWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        }
        const element = surveyWalker.nextNode();
        if (element) surveyElement(element);
        else surveyWalker = null;
    }
    scheduleSurvey();
}
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
    if (document.compatMode !== 'CSS1Compat') {
        for (const entries of deferredCSS.values()) css.push(...entries);
        deferredCSS.clear();
    }
    // Separate CSS rules: one unsupported selector must not invalidate the others.
    const style = document.createElement('style'); styles.add(style);
    cssStyle = style;
    (document.head || document.documentElement).appendChild(style);
    let cssCursor = 0;
    function installCSS() {
        if (stopped) return;
        const start = performance.now();
        while (cssCursor < css.length) {
            const item = css[cssCursor++];
            installCSSItem(item, style);
            if (performance.now() - start > 8) break;
        }
        if (cssCursor < css.length) cssTimer = setTimeout(installCSS, 16);
    }
    installCSS();
    observer = new MutationObserver(records => {
        if (records.every(r => r.type === 'attributes' && r.attributeName?.startsWith('data-bubo-'))) return;
        for (const record of records) {
            if (record.type === 'childList') {
                for (const node of record.addedNodes) queueSurvey(node);
                if (record.target === document && document.documentElement) {
                    queueSurvey(document.documentElement);
                    const target = document.head || document.documentElement;
                    if (cssStyle.parentNode !== target) {
                        target.appendChild(cssStyle);
                        // Reattaching a style may recreate an empty sheet. Replay
                        // all retained declarations through the bounded installer.
                        installedCSS.clear();
                        for (const item of css) queueCSS(item);
                        for (const entries of deferredCSS.values()) for (const item of entries) queueCSS(item);
                    }
                }
            } else if (record.type === 'attributes' && (record.attributeName === 'class' || record.attributeName === 'id')) {
                surveyElement(record.target);
            }
        }
        scheduleSurvey();
        schedule();
    });
    observer.observe(document, {childList:true, subtree:true, attributes:true, characterData:true});
    queueSurvey(document.documentElement); scheduleSurvey(); schedule();
}
function stop() {
    stopped = true; observer?.disconnect(); clearTimeout(timer); clearTimeout(cssTimer); clearTimeout(surveyTimer); pending = false; surveyPending = false;
    for (const node of procedural.styledNodes) {
        node.removeAttribute(procedural.masterToken);
        for (const token of procedural.styleTokenMap.values()) node.removeAttribute(token);
    }
    for (const style of styles) style.remove(); styles.clear();
}
addEventListener('pagehide', event => { if (!event.persisted) stop(); else { observer?.disconnect(); clearTimeout(timer); clearTimeout(surveyTimer); pending=false; surveyPending=false; } });
addEventListener('pageshow', event => { if (event.persisted && !stopped) { observer?.observe(document,{childList:true,subtree:true,attributes:true,characterData:true}); queueSurvey(document.documentElement); scheduleSurvey(); schedule(); } });
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, {once:true}); else start();
