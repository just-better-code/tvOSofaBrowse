// tvOSofaBrowse host adapter. Upstream engines remain unmodified.
const firewall = new HostEngine(), urls = new URLEngine();
let ready = false, installedHostRules, installedURLRules;
globalThis.browserCompileNetwork = function(lists, cached, suffixes) {
    psl.parse(suffixes, punycode.toASCII);
    snfe.reset();
    const stats = {};
    let compiled = cached || '';
    if (!cached) {
        const writer = new CompiledListWriter(), compiler = snfe.createCompiler();
        compiler.start(writer);
        for (const list of lists) {
            writer.properties.set('name', list.id);
            const parser = new AstFilterParser({trustedSource:list.trusted === true, maxTokenLength:snfe.MAX_TOKEN_LENGTH});
            const counts = stats[list.id] = {accepted:0, rejected:0};
            const slices = utils.preparser.splitter(list.text, ['ublock','safari','mobile']);
            for (let i=0; i<slices.length-1; i+=2) {
                const lines = list.text.slice(slices[i],slices[i+1]).split(/\r?\n/);
                for (let index=0; index<lines.length; index++) {
                    let raw = lines[index].trim();
                    while (raw.endsWith(' \\') && index+1<lines.length && lines[index+1].startsWith('    '))
                        raw = raw.slice(0,-2).trim() + lines[++index].trim();
                    if (!raw || /^[!\[]/.test(raw)) continue;
                    const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+(.+)/.exec(raw);
                    const filters = hosts ? hosts[1].replace(/#.*/, '').trim().split(/\s+/) : [raw];
                    for (const filter of filters) {
                        if (!filter || filter === 'localhost' || filter === 'localhost.localdomain') continue;
                        parser.parse(filter);
                        if (!parser.isNetworkFilter()) continue;
                        if (!parser.hasError() && compiler.compile(parser, writer)) counts.accepted++;
                        else counts.rejected++;
                    }
                }
            }
            parser.finish();
        }
        compiler.finish(writer);
        compiled = writer.toString();
    }
    snfe.fromCompiled(new CompiledListReader(compiled));
    snfe.freeze();
    ready = true;
    return {compiled,stats,count:snfe.getFilterCount(),cached:!!cached};
};
globalThis.browserSetDynamicNetwork = function(hostRules, urlRules) {
    hostRules ||= ''; urlRules ||= '';
    if (hostRules !== installedHostRules) { firewall.fromString(hostRules); installedHostRules = hostRules; }
    if (urlRules !== installedURLRules) { urls.fromString(urlRules); installedURLRules = urlRules; }
};
globalThis.browserMatchNetwork = function(details) {
    if (!ready) return {action:0,engine:'unavailable'};
    const context = new FilteringContext().fromDetails(details);
    context.setTabOriginFromURL(details.topURL || details.originURL);
    if (details.method) context.setMethod(String(details.method).toLowerCase());
    const source = context.getTabHostname();
    let action = urls.evaluateZ(source, details.url, details.type);
    let engine = 'dynamic-url';
    const explain = details.type === 'main_frame';
    let logData = explain && action !== 0 ? urls.toLogData() : undefined;
    if (action === 0) {
        action = firewall.evaluateCellZY(source, context.getHostname(), details.type);
        engine = 'dynamic-host';
        logData = explain && action !== 0 ? firewall.toLogData() : undefined;
    }
    if (action === 0 || action === 3) {
        if (explain) {
            // traffic.js returns the winning explicit/generic decision together
            // with its log data. Reading snfe.toLogData() afterward can instead
            // report the last probe, even when that probe lost precedence.
            const strict = shouldStrictBlock(context, false);
            action = strict.result;
            logData = strict.logData;
        } else {
            action = snfe.matchRequest(context);
        }
        engine = 'static';
    }
    const result = {action,engine};
    if (action !== 0 && typeof logData?.raw === 'string') result.rule = logData.raw;
    // Query pruning is implemented entirely by the upstream matcher without the
    // host URL shim. Keep modifiers separate from a blocking/allowing decision.
    if (action !== 1 && /^(GET|HEAD)$/i.test(details.method || 'GET')) {
        snfe.filterQuery(context);
        if (context.redirectURL !== undefined) result.modifiedURL = context.redirectURL;
    }
    return result;
};

// Cache the ready upstream engine, including optimized tries, rather than
// rebuilding it from compiled filter records on every process launch.
const snapshotTypes = Object.assign(Object.create(null), { Int32Array, Uint32Array, Uint8Array });
globalThis.browserSerializeNetwork = function() {
    if (!ready) return '';
    return JSON.stringify({format:1,engine:snfe.toSelfie()}, (_, value) => {
        if (value instanceof Map) return {$browserType:'Map',data:Array.from(value)};
        if (value instanceof Set) return {$browserType:'Set',data:Array.from(value)};
        if (value instanceof RegExp) return {$browserType:'RegExp',source:value.source,flags:value.flags};
        if (ArrayBuffer.isView(value)) {
            const type = value.constructor.name;
            if (!snapshotTypes[type]) throw new Error('Unsupported snapshot array');
            return {$browserType:type,data:Array.from(value)};
        }
        return value;
    });
};
globalThis.browserRestoreNetwork = function(snapshot, suffixes) {
    ready = false;
    try {
        const cached = JSON.parse(snapshot, (_, value) => {
            if (!value || typeof value !== 'object' || !value.$browserType) return value;
            const type = value.$browserType;
            if (type === 'RegExp') return new RegExp(value.source, value.flags);
            if (!Array.isArray(value.data)) throw new Error('Invalid snapshot collection');
            if (type === 'Map') return new Map(value.data);
            if (type === 'Set') return new Set(value.data);
            if (snapshotTypes[type]) return new snapshotTypes[type](value.data);
            throw new Error('Invalid snapshot type');
        });
        if (cached.format !== 1 || !(cached.engine?.bitsToBucket instanceof Map)) return;
        for (const bucket of cached.engine.bitsToBucket.values()) {
            if (!(bucket instanceof Map)) return;
        }
        psl.parse(suffixes, punycode.toASCII);
        if (snfe.fromSelfie(cached.engine) !== true) return;
        ready = true;
        return {count:snfe.getFilterCount(),cached:true,snapshot:true};
    } catch (_) {
        // A stale/corrupt snapshot is disposable. The host retries compiled
        // records or the source lists in this same isolated candidate runtime.
    }
};
