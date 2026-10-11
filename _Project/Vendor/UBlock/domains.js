// tvOSofaBrowse extended-filter domain adapter. Matching follows upstream
// StaticExtFilteringHostnameDB and entityFromHostname; no site source is eval'd.
const entities = new Map(), expressions = new Map();
const entityFor = host => {
    if (entities.has(host)) return entities.get(host);
    const domain = browserSuffixes.getDomain(host);
    const dot = domain.indexOf('.');
    const entity = dot < 0 ? '' : host.slice(0, -domain.length) + domain.slice(0, dot) + '.*';
    entities.set(host, entity);
    return entity;
};
const suffixMatch = (host, pattern) => pattern === '*' || host === pattern || host.endsWith('.' + pattern);
const regexTest = (pattern, value) => {
    let expression = expressions.get(pattern);
    if (expression === undefined) {
        try { expression = new RegExp(pattern); } catch { expression = null; }
        expressions.set(pattern, expression);
    }
    return expression !== null && expression.test(value);
};
const matchDomain = (host, pattern, url) => {
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
        const split = pattern.indexOf('\\/');
        if (split < 0) return regexTest(pattern.slice(1, -1), host);
        return regexTest(pattern.slice(1, split) + '$', host) && regexTest('^' + pattern.slice(split, -1), url);
    }
    const slash = pattern.indexOf('/');
    if (slash >= 0) return suffixMatch(host, pattern.slice(0, slash)) && url.startsWith(pattern.slice(slash));
    return suffixMatch(pattern.endsWith('.*') ? entityFor(host) : host, pattern);
};
const pathname = location.href.slice(location.href.indexOf('/', location.href.indexOf('://') + 3));
const ancestors = [];
try {
    for (const origin of location.ancestorOrigins || []) {
        const host = new URL(origin).hostname.toLowerCase().replace(/\.$/, '');
        if (host && !ancestors.includes(host)) ancestors.push(host);
    }
} catch {}
const applies = rule => {
    const matches = d => d.host.endsWith('>>')
        ? rule.kind === 'scriptlet' && ancestors.some(host => matchDomain(host, d.host.slice(0, -2), ''))
        : matchDomain(hostname, d.host, pathname);
    if (rule.domains.some(d => d.exclude && matches(d))) return false;
    const positives = rule.domains.filter(d => !d.exclude);
    return positives.length === 0 || positives.some(matches);
};
