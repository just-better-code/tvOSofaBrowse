// Native adapter: input is list text with explicit source/trust metadata.
// JSCore has no URL constructor; hostname normalization is supplied by Foundation.
globalThis.URL = class {
    constructor() { this._hostname = ''; }
    set hostname(value) { this._hostname = browserNormalizeHostname(value); }
    get hostname() { return this._hostname; }
};
globalThis.browserPreprocessUBlock = function(text) {
    const slices = utils.preparser.splitter(text, ['ublock', 'safari', 'mobile']);
    let out = '';
    for (let i = 0; i < slices.length - 1; i++) {
        const part = text.slice(slices[i], slices[i+1]);
        out += i % 2 === 0 ? part : part.replace(/[^\n]/g, ' ');
    }
    return out;
};
globalThis.browserCompileUBlock = function(lists, library) {
    const resources = new Map(), aliases = new Map();
    for (const entry of library) {
        resources.set(entry.name, entry);
        for (const alias of entry.aliases) aliases.set(alias, entry.name);
    }
    const parser = new AstFilterParser({ nativeCssHas: false });
    const records = [], stats = {}, rejected = {};
    for (const list of lists) {
        const counts = { cosmetic:0, scriptlet:0, unsupported:0, network:0 };
        stats[list.id] = counts;
        let lineNumber = 0;
        for (const raw of browserPreprocessUBlock(list.text).split(/\r?\n/)) {
            lineNumber++;
            if (raw.trim() === '' || /^[!\[]/.test(raw)) continue;
            // Preprocessor/include directives must not leak inactive branches.
            // Lists passed here are preprocessed by the native adapter below.
            parser.parse(raw);
            if (parser.isNetworkFilter()) { counts.network++; continue; }
            if (!parser.isExtendedFilter()) continue;
            const reject = reason => { counts.unsupported++; rejected[reason] = (rejected[reason] || 0) + 1; };
            if (parser.hasError() || parser.isUnsupported()) { reject('syntax'); continue; }
            const domains = parser.hasOptions() ? Array.from(parser.getExtFilterDomainIterator(), d => ({host:d.hn, exclude:d.not})) : [];
            if (domains.some(d => d.host.includes('/') || d.host.endsWith('.*') || d.host.endsWith('>>'))) {
                reject('domain-pattern'); continue;
            }
            const record = { domains, source:list.id, line:lineNumber, exception:parser.isException() };
            if (parser.isScriptletFilter()) {
                const args = parser.getScriptletArgs();
                if (args.length === 0 && record.exception) {
                    record.kind='scriptlet'; record.key='*'; record.args=[]; records.push(record); continue;
                }
                const token = args[0]?.endsWith('.js') ? args[0] : `${args[0]}.js`;
                const entry = resources.get(aliases.get(token) || token);
                if (!entry || !entry.name.endsWith('.js')) { reject('scriptlet-name'); continue; }
                if (entry.trusted && list.trusted !== true && !record.exception) { reject('untrusted-scriptlet'); continue; }
                record.kind='scriptlet'; record.name=entry.name; record.args=args.slice(1);
                record.world=entry.world; record.key=JSON.stringify([entry.name,...record.args]);
                counts.scriptlet++;
            } else if (parser.isCosmeticFilter()) {
                const compiled = parser.result.compiled;
                if (typeof compiled !== 'string' || compiled === '') { reject('cosmetic'); continue; }
                record.kind='cosmetic'; record.key=parser.result.raw;
                record.compiled=compiled.startsWith('{') ? JSON.parse(compiled) : compiled;
                counts.cosmetic++;
            } else { reject('response-filter'); continue; }
            records.push(record);
        }
    }
    return {records, stats, rejected};
};
