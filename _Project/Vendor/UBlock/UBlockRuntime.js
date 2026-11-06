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
const exceptions = rules.filter(r => r.exception);
const allowed = rule => !exceptions.some(e => e.kind === rule.kind && (e.key === rule.key || e.key === '*'));
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
