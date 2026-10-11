/* tvOSofaBrowse fetch/XHR adapter. No request body, headers or response leave the page. */
(function () {
    'use strict';
    const config = __BROWSER_CONFIG__;
    const handler = window.webkit && window.webkit.messageHandlers.browserNetwork;
    if (!handler || window.__browserNetworkRequestsInstalled) return;
    const apply = Reflect.apply, NativeRequest = window.Request, NativeFetch = window.fetch;
    const nativeSetTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
    const dispatch = EventTarget.prototype.dispatchEvent;
    const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;
    const pending = new Set();
    let epoch = 0, alive = true;
    Object.defineProperty(window, '__browserNetworkRequestsInstalled', { value: true });
    function report(event) {
        try { Promise.resolve(handler.postMessage({ token: config.token, kind: 'event', event })).catch(() => {}); } catch (_) {}
    }
    function abortError() { return new DOMException('The operation was aborted.', 'AbortError'); }
    function signalError(signal) { return signal.reason === undefined ? abortError() : signal.reason; }
    function decide(url, method, api) {
        const currentEpoch = epoch;
        return new Promise(resolve => {
            let done = false;
            const finish = result => {
                if (done) return;
                done = true;
                nativeClearTimeout(timer);
                resolve(!alive || epoch !== currentEpoch ? { cancel: true } : result);
            };
            const timer = nativeSetTimeout(() => { report('fallback'); finish({ action: 0 }); }, 300);
            try {
                Promise.resolve(handler.postMessage({ token: config.token, kind: 'match', url, method, api }))
                    .then(result => finish(result && typeof result === 'object' ? result : { action: 0 }),
                          () => { report('fallback'); finish({ action: 0 }); });
            } catch (_) { report('fallback'); finish({ action: 0 }); }
        });
    }
    function discardBody(request) {
        try { if (request.body) request.body.cancel().catch(() => {}); } catch (_) {}
    }
    let fetchInstalled = false;
    if (typeof NativeFetch === 'function' && typeof NativeRequest === 'function') {
        const wrapped = new Proxy(NativeFetch, {
            apply(target, receiver, args) {
                let request;
                try { request = new NativeRequest(...args); }
                catch (error) { return Promise.reject(error); }
                if (!/^https?:\/\//i.test(request.url)) return apply(target, receiver, [request]);
                return new Promise((resolve, reject) => {
                    let settled = false;
                    const signal = request.signal;
                    const cleanup = () => {
                        pending.delete(cancel);
                        apply(removeListener, signal, ['abort', aborted]);
                    };
                    const fail = error => {
                        if (settled) return;
                        settled = true; cleanup(); discardBody(request); reject(error);
                    };
                    const aborted = () => { report('cancelled'); fail(signalError(signal)); };
                    const cancel = () => { report('cancelled'); fail(abortError()); };
                    if (signal.aborted) { fail(signalError(signal)); return; }
                    if (!alive) { cancel(); return; }
                    pending.add(cancel);
                    apply(addListener, signal, ['abort', aborted, { once: true }]);
                    decide(request.url, request.method, 'fetch').then(result => {
                        if (settled) return;
                        if (result.cancel) { cancel(); return; }
                        if (signal.aborted) { aborted(); return; }
                        if (result.action === 1) {
                            report('fetch-blocked'); fail(new TypeError('Load failed')); return;
                        }
                        settled = true; cleanup();
                        try { resolve(apply(target, receiver, [request])); }
                        catch (error) { reject(error); }
                    });
                });
            }
        });
        try { window.fetch = wrapped; fetchInstalled = window.fetch === wrapped; } catch (_) {}
    }
    // XHR is installed in the next implementation stage.
    const xhrInstalled = false;
    window.addEventListener('pagehide', () => {
        alive = false; epoch++;
        for (const cancel of Array.from(pending)) cancel();
    });
    window.addEventListener('pageshow', () => { alive = true; });
    try {
        Promise.resolve(handler.postMessage({ token: config.token, kind: 'ready', fetch: fetchInstalled, xhr: xhrInstalled })).catch(() => {});
    } catch (_) {}
})();
