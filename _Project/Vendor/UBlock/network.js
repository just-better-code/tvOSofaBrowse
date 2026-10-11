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
    if (action === 0) {
        action = firewall.evaluateCellZY(source, context.getHostname(), details.type);
        engine = 'dynamic-host';
    }
    if (action === 0 || action === 3) { action = snfe.matchRequest(context); engine = 'static'; }
    return {action,engine};
};
