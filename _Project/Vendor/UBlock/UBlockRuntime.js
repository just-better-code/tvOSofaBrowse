/* BrowserUBlock: native WKUserScript adapter for pinned full uBO components. */
(function(){
'use strict';
// A fresh configuration script immediately precedes this reusable source in
// the same content world. Consume it before any website/scriptlet code runs.
const browserConfigurationDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__browserUBlockPendingConfiguration');
const config = __BROWSER_CONFIG__;
if (browserConfigurationDescriptor?.configurable) delete globalThis.__browserUBlockPendingConfiguration;
if (!config || typeof config !== 'object' || config.enabled !== true ||
    typeof config.token !== 'string' || config.token === '' ||
    typeof config.topHost !== 'string' || globalThis.__browserUBlockInstalled) return;
globalThis.__browserUBlockInstalled = true;
const hostname = location.hostname.toLowerCase().replace(/\.$/, '') || config.topHost;
__BROWSER_DOMAINS__
let emitted = 0;
const emit = (event, rule, count = 0) => {
    if (!config.debug || emitted++ >= 128) return;
    try { webkit.messageHandlers.browserUBlock.postMessage({token:config.token, event,
        source:rule?.source || '', line:rule?.line || 0, count}); } catch {}
};
const rules = __BROWSER_RECORDS__.filter(applies);
// Applicability has already resolved hostname/path/ancestor scopes. Index the
// remaining exact exceptions once instead of rescanning them for every rule.
const exceptionKeys = new Map();
for (const rule of rules) {
    if (!rule.exception) continue;
    let keys = exceptionKeys.get(rule.kind);
    if (!keys) exceptionKeys.set(rule.kind, keys = new Set());
    keys.add(rule.key);
}
const allowed = rule => {
    const keys = exceptionKeys.get(rule.kind);
    return !keys || (!keys.has(rule.key) && !keys.has('*'));
};
const scriptletGlobals = new Map();
__BROWSER_FUNCTIONS__
const functions = new Map(__BROWSER_FUNCTION_MAP__);
const executed = new Set();
for (const rule of rules) {
    if (rule.kind !== 'scriptlet' || rule.exception || !allowed(rule) || executed.has(rule.key)) continue;
    executed.add(rule.key);
    try { functions.get(rule.name)?.(...rule.args); emit('scriptlet-installed', rule); }
    catch { emit('scriptlet-error', rule); }
}
__BROWSER_COSMETICS__
})();
