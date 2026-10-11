/* tvOSofaBrowse fetch/XHR adapter. No request body, headers or response leave the page. */
(function installNetworkRequests(config, transport) {
    'use strict';
    const window = globalThis, document = window.document;
    const baseURL = config.baseURL || window.location.href;
    const handler = transport || (window.webkit && window.webkit.messageHandlers.browserNetwork);
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
                          () => { if (!done) report('fallback'); finish({ action: 0 }); });
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
    let xhrInstalled = false;
    const NativeXHR = window.XMLHttpRequest;
    if (typeof NativeXHR === 'function') {
        const proto = NativeXHR.prototype, states = new WeakMap(), listening = new WeakSet();
        const names = ['open', 'send', 'abort', 'setRequestHeader', 'readyState', 'timeout', 'withCredentials'];
        const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(proto, name)]));
        const nativeOpen = proto.open, nativeSend = proto.send, nativeAbort = proto.abort;
        const ready = descriptors.readyState, timeout = descriptors.timeout, credentials = descriptors.withCredentials;
        const NativeProgressEvent = window.ProgressEvent, NativeEvent = window.Event;
        const clock = window.performance.now.bind(window.performance);
        const current = (xhr, state) => states.get(xhr) === state;
        const invalidState = () => new DOMException('The request has already been sent.', 'InvalidStateError');
        function clearGate(state) {
            nativeClearTimeout(state.timer);
            pending.delete(state.cancel);
            state.pending = false;
        }
        function emit(target, type, progress) {
            apply(dispatch, target, [progress ? new NativeProgressEvent(type) : new NativeEvent(type)]);
        }
        function fail(xhr, state, event) {
            if (!current(xhr, state) || !state.pending) return;
            clearGate(state);
            state.terminating = true;
            const active = () => current(xhr, state) && state.terminating;
            apply(nativeAbort, xhr, []);
            state.virtualReady = 1;
            emit(xhr, 'loadstart', true);
            if (!active()) return;
            if (state.hasBody) {
                emit(xhr.upload, 'loadstart', true);
                if (!active()) return;
            }
            state.virtualReady = 4;
            emit(xhr, 'readystatechange', false);
            if (!active()) return;
            if (state.hasBody) {
                emit(xhr.upload, event, true);
                if (!active()) return;
                emit(xhr.upload, 'loadend', true);
                if (!active()) return;
            }
            emit(xhr, event, true);
            if (!active()) return;
            emit(xhr, 'loadend', true);
            if (active()) { state.terminating = false; if (event === 'abort') state.virtualReady = null; }
        }
        function armTimeout(xhr, state) {
            nativeClearTimeout(state.timer);
            if (!state.pending || state.configuredTimeout === 0) return;
            const remaining = state.configuredTimeout - (clock() - state.started);
            state.timer = nativeSetTimeout(() => fail(xhr, state, 'timeout'), Math.max(0, remaining));
        }
        function snapshotBody(body) {
            if (body == null || typeof body === 'string') return body;
            const tag = Object.prototype.toString.call(body);
            if (tag === '[object Blob]' || tag === '[object File]') return body;
            if (tag === '[object FormData]') {
                const copy = new FormData();
                for (const [key, value] of apply(FormData.prototype.entries, body, [])) copy.append(key, value);
                return copy;
            }
            if (tag === '[object URLSearchParams]') return new URLSearchParams(apply(URLSearchParams.prototype.toString, body, []));
            if (tag === '[object ArrayBuffer]') return apply(ArrayBuffer.prototype.slice, body, [0]);
            if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
            if (tag === '[object Document]' || tag === '[object HTMLDocument]' || tag === '[object XMLDocument]') return apply(Node.prototype.cloneNode, body, [true]);
            return String(body);
        }
        if (names.every(name => descriptors[name] && descriptors[name].configurable) && ready.get && timeout.get && timeout.set && credentials.set) {
            const replacements = {
                open: { ...descriptors.open, value: function (...args) {
                    if (args.length < 2) return apply(nativeOpen, this, args);
                    // Snapshot WebIDL strings once; native open still validates method, URL and credentials.
                    args[0] = String(args[0]); args[1] = String(args[1]);
                    const previous = states.get(this);
                    if (previous && previous.adjustedTimeout) apply(timeout.set, this, [previous.configuredTimeout]);
                    const state = { pending: false, nativeSent: false, virtualReady: null,
                        async: args.length < 3 || args[2] === undefined ? true : Boolean(args[2]),
                        method: args[0], url: '', configuredTimeout: apply(timeout.get, this, []) };
                    try { state.url = new URL(args[1], document ? document.baseURI : baseURL).href; } catch (_) {}
                    states.set(this, state);
                    try { apply(nativeOpen, this, args); }
                    catch (error) { if (current(this, state)) { if (previous) states.set(this, previous); else states.delete(this); } throw error; }
                    if (previous) clearGate(previous);
                    if (!current(this, state)) return;
                    if (!listening.has(this)) {
                        listening.add(this);
                        apply(addListener, this, ['loadend', () => {
                        const state = states.get(this);
                        if (!state || !state.nativeSent) return;
                        state.nativeSent = false;
                        if (state.adjustedTimeout) {
                            apply(timeout.set, this, [state.configuredTimeout]); state.adjustedTimeout = false;
                        }
                        }]);
                    }
                } },
                send: { ...descriptors.send, value: function (...args) {
                    const state = states.get(this);
                    if (state && state.pending) throw invalidState();
                    if (!state || !state.async || !/^https?:\/\//i.test(state.url) || apply(ready.get, this, []) !== 1 || state.nativeSent) {
                        if (state && !state.async) report('sync-bypass');
                        return apply(nativeSend, this, args);
                    }
                    // GET/HEAD discard the body in native XHR before body conversion.
                    const body = /^(GET|HEAD)$/i.test(state.method) ? null : snapshotBody(args[0]);
                    state.hasBody = body != null; state.pending = true; state.started = clock();
                    state.configuredTimeout = apply(timeout.get, this, []);
                    state.cancel = () => { report('cancelled'); fail(this, state, 'abort'); };
                    pending.add(state.cancel); armTimeout(this, state);
                    if (!alive) { state.cancel(); return; }
                    decide(state.url, state.method, 'xhr').then(result => {
                        if (!current(this, state) || !state.pending) return;
                        if (result.cancel) { state.cancel(); return; }
                        if (result.action === 1) { report('xhr-blocked'); fail(this, state, 'error'); return; }
                        const elapsed = clock() - state.started;
                        if (state.configuredTimeout > 0 && elapsed >= state.configuredTimeout) { fail(this, state, 'timeout'); return; }
                        clearGate(state); state.nativeSent = true; state.gateDelay = elapsed;
                        if (state.configuredTimeout > 0) {
                            apply(timeout.set, this, [Math.max(1, Math.ceil(state.configuredTimeout - elapsed))]);
                            state.adjustedTimeout = true;
                        }
                        try { apply(nativeSend, this, [body]); }
                        catch (_) {
                            state.nativeSent = false;
                            if (state.adjustedTimeout) { apply(timeout.set, this, [state.configuredTimeout]); state.adjustedTimeout = false; }
                            state.pending = true; fail(this, state, 'error');
                        }
                    });
                } },
                abort: { ...descriptors.abort, value: function (...args) {
                    const state = states.get(this);
                    if (state && state.pending) { state.cancel(); return; }
                    if (state) { state.terminating = false; state.virtualReady = null; }
                    return apply(nativeAbort, this, args);
                } },
                readyState: { ...ready, get: function () {
                    const value = apply(ready.get, this, []), state = states.get(this);
                    return state && state.virtualReady != null ? state.virtualReady : value;
                } },
                timeout: { ...timeout, get: function () {
                    const value = apply(timeout.get, this, []), state = states.get(this);
                    return state && state.adjustedTimeout ? state.configuredTimeout : value;
                }, set: function (value) {
                    apply(timeout.set, this, [value]);
                    const state = states.get(this);
                    if (!state) return;
                    state.configuredTimeout = apply(timeout.get, this, []);
                    if (state.pending) armTimeout(this, state);
                    else if (state.nativeSent && state.gateDelay > 0) {
                        const remaining = state.configuredTimeout === 0 ? 0 : Math.max(1, Math.ceil(state.configuredTimeout - state.gateDelay));
                        apply(timeout.set, this, [remaining]); state.adjustedTimeout = true;
                    }
                } },
                withCredentials: { ...credentials, set: function (value) {
                    const state = states.get(this);
                    if (state && state.pending) throw invalidState();
                    apply(credentials.set, this, [value]);
                } }
            };
            for (const name of ['setRequestHeader']) {
                replacements[name] = { ...descriptors[name], value: function (...args) {
                    const state = states.get(this);
                    if (state && state.pending) throw invalidState();
                    return apply(descriptors[name].value, this, args);
                } };
            }
        // Install atomically or retain the native path on runtimes with incompatible descriptors.
            try { Object.defineProperties(proto, replacements); xhrInstalled = true; }
            catch (_) { for (const name of names) { try { Object.defineProperty(proto, name, descriptors[name]); } catch (_) {} } }
        }
    }
    const lifecycle = {
        suspend() { alive = false; epoch++; for (const cancel of Array.from(pending)) cancel(); },
        resume() { alive = true; }
    };
    if (document) {
        window.addEventListener('pagehide', lifecycle.suspend);
        window.addEventListener('pageshow', lifecycle.resume);
    }
    try {
        Promise.resolve(handler.postMessage({ token: config.token, kind: 'ready', fetch: fetchInstalled, xhr: xhrInstalled })).catch(() => {});
    } catch (_) {}
    return lifecycle;
})(__BROWSER_CONFIG__);
