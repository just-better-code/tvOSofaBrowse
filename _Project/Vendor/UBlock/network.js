// tvOSofaBrowse host adapter. Upstream engines remain unmodified.
const firewall = new HostEngine(), urls = new URLEngine();
let ready = false, installedHostRules, installedURLRules;
// Keep each source's serialized blocks independent. Concatenating block texts
// would overwrite repeated section IDs in CompiledListReader.
function browserCompiledNetworkValid(raw) {
    if (typeof raw !== 'string') return false;
    const sections = new Set();
    let offset = 0;
    try {
        while (offset < raw.length) {
            const match = /^#block-start-([\w:]+)\n/.exec(raw.slice(offset));
            if (!match || !['NETWORK_FILTERS:GOOD','NETWORK_FILTERS:BAD'].includes(match[1]) || sections.has(match[1])) return false;
            sections.add(match[1]);
            const start = offset + match[0].length;
            const marker = '\n#block-end-' + match[1];
            const end = raw.indexOf(marker,start);
            if (end < start) return false;
            for (const line of raw.slice(start,end).split('\n')) if (!line || !Array.isArray(JSON.parse(line))) return false;
            offset = end + marker.length;
            if (offset < raw.length) { if (raw[offset] !== '\n') return false; offset++; }
        }
        return true;
    } catch { return false; }
}
globalThis.browserBeginNetworkCompilation = function(suffixes) {
    ready=false; psl.parse(suffixes,punycode.toASCII); snfe.reset();
};
globalThis.browserCompileNetworkSource = function(list) {
    const writer = new CompiledListWriter(), compiler = snfe.createCompiler();
    compiler.start(writer);
    writer.properties.set('name', list.id);
    const parser = new AstFilterParser({trustedSource:list.trusted === true, maxTokenLength:snfe.MAX_TOKEN_LENGTH});
    const counts = {accepted:0,rejected:0};
    try {
        const slices = utils.preparser.splitter(list.text, ['ublock','safari','mobile']);
        for (let i=0; i<slices.length-1; i+=2) {
            const lines = list.text.slice(slices[i],slices[i+1]).split(/\r?\n/);
            for (let index=0; index<lines.length; index++) {
                if ((index & 255) === 0 && globalThis.browserPreparationCancelled?.()) throw new Error('Preparation superseded');
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
                    if (!parser.hasError() && compiler.compile(parser,writer)) counts.accepted++;
                    else counts.rejected++;
                }
            }
        }
    } finally { parser.finish(); }
    compiler.finish(writer);
    return {compiled:writer.toString(),stats:counts};
};
globalThis.browserRestoreCompiledNetworkSources = function(records,suffixes) {
    ready=false;
    psl.parse(suffixes,punycode.toASCII);
    snfe.reset();
    const stats={};
    for (const record of records) {
        if (globalThis.browserPreparationCancelled?.()) throw new Error('Preparation superseded');
        if (!browserCompiledNetworkValid(record.compiled)) throw new Error("Invalid compiled source");
        snfe.fromCompiled(new CompiledListReader(record.compiled));
        stats[record.id]=record.stats;
    }
    snfe.freeze(); ready=true;
    return {stats,count:snfe.getFilterCount(),cached:false};
};
// Compatibility entry point retained for tools and older callers.
globalThis.browserCompileNetwork = function(lists,cached,suffixes) {
    if (cached) {
        if (!browserCompiledNetworkValid(cached)) throw new Error("Invalid compiled source");
        psl.parse(suffixes,punycode.toASCII); snfe.reset();
        snfe.fromCompiled(new CompiledListReader(cached)); snfe.freeze(); ready=true;
        return {compiled:cached,stats:{},count:snfe.getFilterCount(),cached:true};
    }
    // A single writer preserves the legacy collecting API's block shape.
    browserBeginNetworkCompilation(suffixes);
    const records=lists.map(list=>({id:list.id,...browserCompileNetworkSource(list)}));
    const summary=browserRestoreCompiledNetworkSources(records,suffixes);
    const writer=new CompiledListWriter();
    for (const record of records) {
        const reader=new CompiledListReader(record.compiled);
        for (const [id,block] of reader.blocks) {
            writer.select(id); if(block) for (const line of block.split('\n')) if (line) writer.block.push(line);
        }
    }
    return {...summary,compiled:writer.toString()};
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
